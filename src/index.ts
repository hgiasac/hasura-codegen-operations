#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { printSchema, parse } from "graphql";
import * as hasuraPlugin from "graphql-codegen-hasura-operations";
import * as hasuraSchemaPlugin from "graphql-codegen-hasura-schemas";
import { loadSchema } from "@graphql-tools/load";
import { UrlLoader } from "@graphql-tools/url-loader";
import { codegen } from "@graphql-codegen/core";
import { Types } from "@graphql-codegen/plugin-helpers";
import { config as dotenvConfig } from "dotenv";
import { parse as parseYaml } from "yaml";
import { env } from "string-env-interpolation";
import { prompt } from "enquirer";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import renderTemplate from "./template";

type QuestionResult = {
  url: string;
  adminSecret: string;
  role: string;
  models: string[];
  maxDepth: number;
  enableSubfieldArgs: boolean;
  disableFragments: boolean;
  disableArgSuffixes: string[];
  outputPath: string;
  outputFilePrefix: string;
  enableQuery: boolean;
  enableMutation: boolean;
  enableSubscription: boolean;
  separateFiles: boolean;
  renderTemplate: boolean;
  templatePath: string;
  disableFields: string[];
};

type DefaultOptions = QuestionResult & {
  headers: Record<string, string>;
  method: string;
  silent: boolean;
};

const PATTERN_NAMES_WITH_COMMA = /\w+(,\w+)?/;

const bootstrap = async () => {
  const argv = await yargs(hideBin(process.argv)).argv;

  const envOutput = dotenvConfig();

  let codegenConfigFile =
    process.env.CONFIG_PATH || (argv.config as string) || "codegen.yml";
  console.warn(`trying to read config file ${codegenConfigFile}...`);

  if (!existsSync(codegenConfigFile)) {
    codegenConfigFile = "codegen.yaml";
  }

  let configYaml = {} as Types.Config;

  if (existsSync(codegenConfigFile)) {
    const configString = readFileSync(
      path.join(process.cwd(), codegenConfigFile),
      "utf-8"
    );

    const interpolationConfig = env(configString, envOutput.parsed || {});
    configYaml = parseYaml(interpolationConfig);
  } else {
    console.warn("WARNING: the config file is not found");
  }

  const defaultConfigs = ((configYaml as unknown as Record<string, string>)
    .hasura ?? {}) as Partial<DefaultOptions>;

  if (configYaml.schema) {
    switch (typeof configYaml.schema) {
      case "string":
        defaultConfigs.url = configYaml.schema;
        break;
      case "object":
        if (!Array.isArray(configYaml.schema)) {
          throw new Error(
            `invalid schema config, expected string or array object, got object`
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
          `invalid schema config, expected string or array object, got ${typeof configYaml.schema}`
        );
    }
  }

  const questions: any[] = [
    !defaultConfigs.url
      ? {
          type: "input",
          name: "url",
          message: "What is the graphql endpoint?",
          validate(value: string): string | boolean {
            if (!value) {
              return "the graphql endpoint url is required";
            }
            return true;
          },
        }
      : null,
    !defaultConfigs.adminSecret
      ? {
          type: "input",
          name: "adminSecret",
          message: "What is the admin secret?",
        }
      : null,
    !defaultConfigs.role
      ? {
          type: "input",
          name: "role",
          message: "What is the default role?",
          initial: "admin",
        }
      : null,
    {
      type: "input",
      name: "models",
      message: "What models do you need to generate? (separated by comma)",
      result: parseArrayString,
      validate(value: string): string | boolean {
        if (!value || !PATTERN_NAMES_WITH_COMMA.test(value)) {
          return "models value is empty or in invalid format";
        }
        return true;
      },
    },
    defaultConfigs.silent && defaultConfigs.maxDepth
      ? null
      : {
          type: "numeral",
          name: "maxDepth",
          message: "What is the max depth of output sub-fields?",
          initial: defaultConfigs.maxDepth ?? 1,
          validate(value: unknown) {
            const message = "maxDepth must be larger than 0";
            try {
              if (!value) {
                return message;
              }

              const numberValue =
                typeof value === "number"
                  ? value
                  : parseInt(value as string, 10);
              if (numberValue <= 0) {
                return message;
              }

              return true;
            } catch {
              return message;
            }
          },
        },
    defaultConfigs.silent && defaultConfigs.enableQuery !== undefined
      ? null
      : {
          type: "toggle",
          name: "enableQuery",
          message: "Enable queries?",
          initial: defaultConfigs.enableQuery ?? true,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.enableMutation !== undefined
      ? null
      : {
          type: "toggle",
          name: "enableMutation",
          message: "Enable mutations?",
          initial: defaultConfigs.enableMutation ?? true,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.enableSubscription !== undefined
      ? null
      : {
          type: "toggle",
          name: "enableSubscription",
          message: "Enable subscriptions?",
          initial: defaultConfigs.enableSubscription ?? false,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.enableSubfieldArgs !== undefined
      ? null
      : {
          type: "toggle",
          name: "enableSubfieldArgs",
          message: "Enable arguments of sub-fields?",
          initial: defaultConfigs.enableSubfieldArgs ?? false,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.disableFragments !== undefined
      ? null
      : {
          type: "toggle",
          name: "disableFragments",
          message: "Disable fragment types?",
          initial: defaultConfigs.disableFragments ?? false,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.disableArgSuffixes !== undefined
      ? null
      : {
          type: "input",
          name: "disableArgSuffixes",
          message: "Hide argument suffix types?",
          initial: defaultConfigs.disableArgSuffixes
            ? defaultConfigs.disableArgSuffixes.join(",")
            : "",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "disableArgSuffixes format is invalid";
            }
            return true;
          },
        },
    defaultConfigs.silent && defaultConfigs.outputPath !== undefined
      ? null
      : {
          type: "input",
          name: "outputPath",
          message: "Where should we generate the file to?",
          initial: defaultConfigs.outputPath ?? ".",
        },
    defaultConfigs.silent && defaultConfigs.separateFiles !== undefined
      ? null
      : {
          type: "toggle",
          name: "separateFiles",
          message: "Separate different graphql files for each model?",
          initial: defaultConfigs.separateFiles ?? true,
          enabled: "Yep",
          disabled: "Nope",
        },
    defaultConfigs.silent && defaultConfigs.outputFilePrefix !== undefined
      ? null
      : {
          type: "input",
          name: "outputFilePrefix",
          message: "What prefix of graphql files should we generate to?",
          initial: defaultConfigs.outputFilePrefix ?? "",
        },
    {
      type: "toggle",
      name: "renderTemplate",
      message: "Continue to generate template?",
      initial: defaultConfigs.renderTemplate ?? false,
      skip:
        defaultConfigs.silent && defaultConfigs.renderTemplate !== undefined,
      enabled: "Yep",
      disabled: "Nope",
    },
  ].filter((m) => m);

  const templatePromptOptions: any[] = [
    defaultConfigs.silent && defaultConfigs.disableFields !== undefined
      ? null
      : {
          type: "input",
          name: "disableFields",
          message: "What fields should we exclude from models?",
          initial: defaultConfigs.disableFields?.join(",") ?? "",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "disableFields format is invalid";
            }
            return true;
          },
        },
    defaultConfigs.silent && defaultConfigs.templatePath !== undefined
      ? null
      : {
          type: "input",
          name: "templatePath",
          message: "What template path should we render?",
          initial: defaultConfigs.templatePath ?? "_templates/hello",
          validate(value: string): string | boolean {
            if (!value || !existsSync(value)) {
              return "template path does not exist";
            }
            return true;
          },
        },
  ].filter((s) => s);

  const generate = async (options: QuestionResult) => {
    console.log("rendering files...");

    const url = options.url || defaultConfigs.url;
    const adminSecret = options.adminSecret || defaultConfigs.adminSecret;
    const role = options.role || defaultConfigs.role;

    const schema = await loadSchema(url, {
      loaders: [new UrlLoader()],
      headers: {
        Accept: "application/json",
        ...defaultConfigs.headers,
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
      method: defaultConfigs.method ?? "POST",
    });

    const genGraphQL = async (models: string[]) => {
      const outputFileName = `${options.outputFilePrefix}${models.join(
        "_"
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
              tables: models,
              disableOperationTypes,
              maxDepth: options.maxDepth,
              enableSubfieldArgs: options.enableSubfieldArgs,
              disableFragments: options.disableFragments,
              disableArgSuffixes: options.disableArgSuffixes,
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
    if (!options.separateFiles) {
      await genGraphQL(models);
    } else {
      await Promise.all(models.map((model) => genGraphQL([model])));
    }

    if (options.renderTemplate) {
      const config: Types.GenerateOptions = {
        documents: [],
        config: {},
        // used by a plugin internally, although the 'typescript' plugin currently
        // returns the string output, rather than writing to a file
        filename: "temp.json",
        schema: parse(printSchema(schema)),
        plugins: [
          {
            "graphql-codegen-hasura-schemas": {
              models,
              disableFields: options.disableFields,
            },
          },
        ],
        pluginMap: {
          "graphql-codegen-hasura-schemas": hasuraSchemaPlugin,
        },
      };

      const output = await codegen(config);
      const modelSchemas: hasuraSchemaPlugin.ModelSchemas = JSON.parse(output);

      // try to load extra prompt
      const promptTemplatePath = path.resolve(
        options.templatePath,
        "prompt.js"
      );
      let templateArguments = {};
      if (existsSync(promptTemplatePath)) {
        const templatePromptOptions = await import(promptTemplatePath);

        templateArguments = await prompt(templatePromptOptions.default);
      }

      await Promise.all(
        Object.keys(modelSchemas).map((modelName) =>
          renderTemplate(
            {
              actionfolder: options.templatePath,
              modelName,
              hasuraModel: modelSchemas[modelName],
              ...templateArguments,
            },
            {}
          )
        )
      );
    }

    console.log("Outputs generated!");
  };

  prompt<QuestionResult>(questions)
    .then((answer) =>
      answer.renderTemplate && templatePromptOptions.length
        ? prompt(templatePromptOptions).then((templateAnswer) => ({
            ...answer,
            ...templateAnswer,
          }))
        : answer
    )
    .then((result) =>
      generate({
        ...defaultConfigs,
        ...result,
      })
    )
    .catch((err) => {
      console.error(err);
    });
};

const parseArrayString = (input: string): string[] => {
  if (!input) {
    return [];
  }
  return input
    .trim()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);
};

bootstrap();
