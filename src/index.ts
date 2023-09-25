#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { printSchema, parse } from "graphql";
import * as hasuraPlugin from "graphql-codegen-hasura-operations";
import { loadSchema } from "@graphql-tools/load";
import { UrlLoader } from "@graphql-tools/url-loader";
import { codegen } from "@graphql-codegen/core";
import { Types } from "@graphql-codegen/plugin-helpers";
import { config as dotenvConfig } from "dotenv";
import { parse as parseYaml } from "yaml";
import { env } from "string-env-interpolation";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import renderTemplate from "./template";
import buildModelSchemas from "./schema";
import startPrompt, { Action, GenerateOptions } from "./prompt";
import { prompt } from "enquirer";
import { parallel } from "radash";

const generate = async (actions: Action[], options: GenerateOptions) => {
  console.log("\nprepare rendering files...");

  const url = options.url;
  const adminSecret = options.adminSecret;
  const role = options.role;

  const schema = await loadSchema(url, {
    loaders: [new UrlLoader()],
    headers: {
      Accept: "application/json",
      ...options.headers,
      ...(role
        ? {
            "x-hasura-role": role,
          }
        : null),
      ...(adminSecret
        ? {
            "x-hasura-admin-secret": adminSecret,
          }
        : null),
    },
    method: options.method ?? "POST",
  });

  const genGraphQL = async (models: string[]) => {
    const outputFileName = `${options.outputFilePrefix}${models.join(
      "_",
    )}.graphql`;
    const outputFilePath = path.resolve(options.outputPath, outputFileName);
    const disableOperationTypes = [
      options.enableQuery ? null : "query",
      options.enableMutation ? null : "mutation",
      options.enableSubscription ? null : "subscription",
    ].filter((s) => s);
    const config: Types.GenerateOptions = {
      documents: [],
      config: {},
      // used by a plugin internally, although the 'typescript' plugin currently
      // returns the string output, rather than writing to a file
      filename: outputFilePath,
      schema: parse(printSchema(schema)),
      plugins: [
        {
          "graphql-codegen-hasura-graphql": {
            models,
            disableOperationTypes,
            maxDepth: options.maxDepth,
            enableSubfieldArgs: options.enableSubfieldArgs,
            disableFragments: options.disableFragments,
            disableArgSuffixes: options.disableArgSuffixes,
            disableFields: options.disableFields,
            disableFieldPrefixes: options.disableFieldPrefixes,
            disableFieldSuffixes: options.disableFieldSuffixes,
          },
        },
      ],
      pluginMap: {
        "graphql-codegen-hasura-graphql": hasuraPlugin,
      },
    };

    const output = await codegen(config);
    if (options.outputPath) {
      mkdirSync(options.outputPath, { recursive: true });
    }
    writeFileSync(outputFilePath, output, "utf8");
  };

  const models = options.models;
  if (actions.includes("graphql")) {
    if (!options.separateFiles) {
      await genGraphQL(models);
    } else {
      await Promise.all(models.map((model) => genGraphQL([model])));
    }
  }

  if (actions.includes("template")) {
    const modelSchemas = buildModelSchemas(schema, models, {
      disableFields: options.disableFields,
      disableFieldPrefixes: options.disableFieldPrefixes,
      disableFieldSuffixes: options.disableFieldSuffixes,
      primaryKeyNames: options.primaryKeyNames,
      headFields: options.headFields,
      tailFields: options.tailFields,
    });

    // try to load extra prompt
    const promptTemplatePath = path.resolve(options.templatePath, "prompt.js");
    let templateArguments = {};
    if (existsSync(promptTemplatePath)) {
      const templatePromptOptions = await import(promptTemplatePath);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (templatePromptOptions.default) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        templateArguments = await prompt(templatePromptOptions.default);
      }
    }

    await parallel(1, Object.keys(modelSchemas), (modelName) =>
      renderTemplate(
        {
          actionfolder: options.templatePath,
          modelName,
          ...modelSchemas[modelName],
          ...templateArguments,
        },
        {},
      ),
    );
  }

  console.log("\nOutputs generated!");
};

const bootstrap = async () => {
  const argv = await yargs(hideBin(process.argv)).argv;

  const envOutput = dotenvConfig();

  let codegenConfigFile =
    process.env.CONFIG_PATH ??
    (argv.config as string | undefined) ??
    "codegen.yml";
  console.warn(`trying to read config file ${codegenConfigFile}...`);

  if (!existsSync(codegenConfigFile)) {
    codegenConfigFile = "codegen.yaml";
  }

  let configYaml = {} as Types.Config;

  if (existsSync(codegenConfigFile)) {
    const configString = readFileSync(
      path.join(process.cwd(), codegenConfigFile),
      "utf-8",
    );

    const interpolationConfig = env(configString, envOutput.parsed ?? {});
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    configYaml = parseYaml(interpolationConfig);
  } else {
    console.warn("WARNING: the config file is not found");
  }

  const defaultConfigs = ((
    configYaml as unknown as Record<string, string> | null
  )?.hasura ?? {}) as Partial<GenerateOptions>;

  if (configYaml.schema) {
    switch (typeof configYaml.schema) {
      case "string":
        defaultConfigs.url = configYaml.schema;
        break;
      case "object":
        if (!Array.isArray(configYaml.schema)) {
          throw new Error(
            `invalid schema config, expected string or array object, got object`,
          );
        }

        const schemaConfig = configYaml.schema[0];
        const url = Object.keys(schemaConfig)[0];
        defaultConfigs.url = url;
        defaultConfigs.headers = schemaConfig[url].headers;
        defaultConfigs.method = schemaConfig[url].method || "POST";
        if (defaultConfigs.headers) {
          if (defaultConfigs.headers["x-hasura-admin-secret"]) {
            defaultConfigs.adminSecret =
              defaultConfigs.headers["x-hasura-admin-secret"];
          }
          if (defaultConfigs.headers["x-hasura-role"]) {
            defaultConfigs.role = defaultConfigs.headers["x-hasura-role"];
          }
        }
        break;
      default:
        throw new Error(
          `invalid schema config, expected string or array object, got ${typeof configYaml.schema}`,
        );
    }
  }

  return startPrompt(defaultConfigs)
    .then(([actions, options]) => generate(actions, options))
    .catch((err) => {
      console.error("failed to generate: ", err.message);
    });
};

void bootstrap();
