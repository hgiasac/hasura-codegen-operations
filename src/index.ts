#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
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

    const interpolationConfig = envOutput.parsed
      ? env(configString, envOutput.parsed || {})
      : configString;
    configYaml = parseYaml(interpolationConfig);
  } else {
    console.warn("WARNING: the config file is not found");
  }

  let url: string;
  let headers: Record<string, string> = {};
  let method = "POST";

  if (configYaml.schema) {
    switch (typeof configYaml.schema) {
      case "string":
        url = configYaml.schema;
        break;
      case "object":
        if (!Array.isArray(configYaml.schema)) {
          throw new Error(
            `invalid schema config, expected string or array object, got object`
          );
        }

        const schemaConfig = configYaml.schema[0];
        url = Object.keys(schemaConfig)[0];
        headers = schemaConfig[url].headers;
        method = schemaConfig[url].method || "POST";
        break;
      default:
        throw new Error(
          `invalid schema config, expected string or array object, got ${typeof configYaml.schema}`
        );
    }
  }

  const basePath =
    (configYaml as unknown as Record<string, string>).basePath || ".";

  const questions = [
    !url
      ? {
          type: "input",
          name: "url",
          message: "What is the graphql endpoint?",
        }
      : null,
    !headers["x-hasura-admin-secret"]
      ? {
          type: "input",
          name: "adminSecret",
          message: "What is the admin secret?",
        }
      : null,
    !headers["x-hasura-role"]
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
    },
    {
      type: "numeral",
      name: "maxDepth",
      message: "What is the max depth of output sub-fields?",
      initial: 1,
    },
    {
      type: "toggle",
      name: "enableQuery",
      message: "Enable queries?",
      initial: true,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableMutation",
      message: "Enable mutations?",
      initial: true,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableSubscription",
      message: "Enable subscriptions?",
      initial: false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableSubfieldArgs",
      message: "Enable arguments of sub-fields?",
      initial: false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "toggle",
      name: "enableFragments",
      message: "Disable fragment types?",
      initial: false,
      enabled: "Yep",
      disabled: "Nope",
    },
    {
      type: "input",
      name: "outputPath",
      message: "Where should we generate the file to?",
      initial: basePath,
    },
    {
      type: "input",
      name: "outputFile",
      message:
        "What name of the file should we generate to? (default: <model_name>.graphql)",
      initial: "",
    },
  ].filter((t) => t);

  type QuestionResult = {
    url: string;
    adminSecret: string;
    role: string;
    tables: string;
    maxDepth: number;
    enableSubfieldArgs: boolean;
    disableFragments: boolean;
    outputPath: string;
    outputFile: string;
    enableQuery: boolean;
    enableMutation: boolean;
    enableSubscription: boolean;
  };

  const generate = async (options: QuestionResult) => {
    url = options.url || url;
    const adminSecret = options.adminSecret || headers["x-hasura-admin-secret"];
    const role = options.role || headers["x-hasura-role"];

    const schema = await loadSchema(url, {
      loaders: [new UrlLoader()],
      headers: {
        Accept: "application/json",
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
      method,
    });

    const tables = options.tables.split(",").map((s) => s.trim());
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
          }, // Here you can pass configuration to the plugin
        },
      ],
      pluginMap: {
        "graphql-codegen-hasura-graphql": hasuraPlugin,
      },
    };

    const output = await codegen(config);
    writeFileSync(outputFilePath, output, "utf8");
    console.log("Outputs generated!");
  };

  prompt<QuestionResult>(questions)
    .then((result) => generate(result))
    .catch((err) => {
      console.error(err);
    });
};

bootstrap();
