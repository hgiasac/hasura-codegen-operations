#!/usr/bin/env node

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
import { prompt } from "enquirer";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

type QuestionResult = {
  url: string;
  adminSecret: string;
  role: string;
  tables: string;
  maxDepth: number;
  enableSubfieldArgs: boolean;
  disableFragments: boolean;
  disableArgSuffixes: string;
  outputPath: string;
  outputFile: string;
  enableQuery: boolean;
  enableMutation: boolean;
  enableSubscription: boolean;
};

type DefaultOptions = Omit<QuestionResult, "disableArgSuffixes"> & {
  headers: Record<string, string>;
  method: string;
  disableArgSuffixes: string[];
};

const PATTERN_NAMES_WITH_COMMA = /\w+(,\w+)?/;

const bootstrap = async () => {
  const argv = await yargs(hideBin(process.argv)).argv;
  const envOutput = dotenvConfig();

  if (envOutput.error) {
    console.warn(envOutput.error);
  }

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

  const questions = [
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
      name: "tables",
      message: "What models do you need to generate? (separated by comma)",
      validate(value: string): string | boolean {
        if (!value || !PATTERN_NAMES_WITH_COMMA.test(value)) {
          return "tables value is empty or invalid format";
        }
        return true;
      },
    },
    {
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
            typeof value === "number" ? value : parseInt(value as string, 10);
          if (numberValue <= 0) {
            return message;
          }

          return true;
        } catch {
          return message;
        }
      },
    },
    {
      type: "toggle",
      name: "enableQuery",
      message: "Enable queries?",
      initial: defaultConfigs.enableQuery ?? true,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableMutation",
      message: "Enable mutations?",
      initial: defaultConfigs.enableMutation ?? true,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableSubscription",
      message: "Enable subscriptions?",
      initial: defaultConfigs.enableSubscription ?? false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableSubfieldArgs",
      message: "Enable arguments of sub-fields?",
      initial: defaultConfigs.enableSubfieldArgs ?? false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "disableFragments",
      message: "Disable fragment types?",
      initial: defaultConfigs.disableFragments ?? false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "input",
      name: "disableArgSuffixes",
      message: "Hide argument suffix types?",
      initial: defaultConfigs.disableArgSuffixes
        ? defaultConfigs.disableArgSuffixes.join(",")
        : "",
      validate(value: string): string | boolean {
        if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
          return "disableArgSuffixes is invalid format";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "outputPath",
      message: "Where should we generate the file to?",
      initial: defaultConfigs.outputPath ?? ".",
    },
    {
      type: "input",
      name: "outputFile",
      message:
        "What name of the file should we generate to? (default: <model_name>.graphql)",
      initial: "",
    },
  ].filter((t) => t);

  const generate = async (options: QuestionResult) => {
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

    const tables = parseArrayString(options.tables);
    const outputFileName = options.outputFile || `${tables.join("_")}.graphql`;
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
        // Each plugin should be an object
        {
          "graphql-codegen-hasura-graphql": {
            tables,
            disableOperationTypes,
            maxDepth: options.maxDepth,
            enableSubfieldArgs: options.enableSubfieldArgs,
            disableFragments: options.disableFragments,
            disableArgSuffixes: parseArrayString(options.disableArgSuffixes),
          }, // Here you can pass configuration to the plugin
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
    console.log("Outputs generated!");
  };

  prompt<QuestionResult>(questions)
    .then((result) => generate(result))
    .catch((err) => {
      console.error(err);
    });
};

const parseArrayString = (input: string): string[] => {
  if (!input) {
    return [];
  }
  return input.split(",").map((s) => s.trim());
};

bootstrap();
