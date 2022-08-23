#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
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

const envOutput = dotenvConfig();

if (envOutput.error) {
  console.warn(envOutput.error);
}

const configString = readFileSync(
  path.join(process.cwd(), "codegen.yml"),
  "utf-8"
);
const interpolationConfig = envOutput.parsed
  ? env(configString, envOutput.parsed || {})
  : configString;
const configYaml = parseYaml(interpolationConfig) as Types.Config;

let url: string;
let headers: Record<string, string> = {};
let method = "POST";

if (configYaml.schema?.length) {
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
    message: "What tables do you need to generate? (separated by comma)",
  },
  {
    type: "numeral",
    name: "maxDepth",
    message: "What is the max depth of output sub-fields?",
    initial: 2,
  },
  {
    type: "toggle",
    name: "disableSubfieldArgs",
    message: "Disable arguments of sub-fields?",
    initial: true,
    enabled: "Yep",
    disabled: "Nope",
  },
  {
    type: "toggle",
    name: "enableFragments",
    message: "Enable fragment types?",
    initial: true,
    enabled: "Yep",
    disabled: "Nope",
  },
  {
    type: "input",
    name: "outputFile",
    message: "Where should we generate the file to?",
    initial: "output.graphql",
  },
].filter((t) => t);

type QuestionResult = {
  url: string;
  adminSecret: string;
  role: string;
  tables: string;
  maxDepth: number;
  disableSubfieldArgs: boolean;
  enableFragments: boolean;
  outputFile: string;
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

  const config: Types.GenerateOptions = {
    documents: [],
    config: {},
    // used by a plugin internally, although the 'typescript' plugin currently
    // returns the string output, rather than writing to a file
    filename: options.outputFile,
    schema: parse(printSchema(schema)),
    plugins: [
      // Each plugin should be an object
      {
        "graphql-codegen-hasura-graphql": {
          tables: options.tables.split(",").map((s) => s.trim()),
          maxDepth: options.maxDepth,
          disableSubfieldArgs: options.disableSubfieldArgs,
          enableFragments: options.enableFragments,
        }, // Here you can pass configuration to the plugin
      },
    ],
    pluginMap: {
      "graphql-codegen-hasura-graphql": hasuraPlugin,
    },
  };

  const output = await codegen(config);
  writeFileSync(options.outputFile, output, "utf8");
  console.log("Outputs generated!");
};

prompt<QuestionResult>(questions)
  .then((result) => generate(result))
  .catch((err) => {
    console.error(err);
  });
