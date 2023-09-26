import { prompt } from "enquirer";
import { existsSync } from "fs";

const PATTERN_NAMES_WITH_COMMA = /\w+(,\w+)?/;
export type Action = "graphql" | "template" | "all";

const parseActions = (action: Action): Action[] => {
  return action === "all" ? ["graphql", "template"] : [action];
};

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
  templatePath: string;
  disableFields: string[];
  disableFieldPrefixes: string[];
  disableFieldSuffixes: string[];
  primaryKeyNames: string[];
  headFields: string[];
  tailFields: string[];
};

export type GenerateOptions = QuestionResult & {
  headers?: Record<string, string>;
  method?: string;
  silent?: boolean;
};

const actionQuestions = [
  {
    type: "select",
    name: "action",
    message: "Please choose action",
    initial: "graphql",
    choices: [
      { name: "graphql", message: "Generate GraphQL", value: "graphql" },
      { name: "template", message: "Generate Template", value: "template" },
      { name: "all", message: "All", value: "all" },
    ],
  },
];

const startPrompt = async (
  actionArg: Action | undefined,
  defaultConfigs: Partial<GenerateOptions>,
): Promise<[Action[], GenerateOptions]> => {
  const sharedQuestions = [
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
    defaultConfigs.silent && defaultConfigs.disableFieldPrefixes !== undefined
      ? null
      : {
          type: "input",
          name: "disableFieldPrefixes",
          message: "What field prefixes should we exclude from models?",
          initial: defaultConfigs.disableFieldPrefixes?.join(",") ?? "",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "disableFieldPrefixes format is invalid";
            }
            return true;
          },
        },
    defaultConfigs.silent && defaultConfigs.disableFieldSuffixes !== undefined
      ? null
      : {
          type: "input",
          name: "disableFieldSuffixes",
          message: "What field suffixes should we exclude from models?",
          initial: defaultConfigs.disableFieldSuffixes?.join(",") ?? "",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "disableFieldSuffixes format is invalid";
            }
            return true;
          },
        },
  ];

  const graphqlQuestions = [
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
    {
      type: "input",
      name: "outputPath",
      message: "What folder should we generate graphql files to?",
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
  ].filter((m) => m);

  const templateQuestions = [
    defaultConfigs.silent && defaultConfigs.primaryKeyNames !== undefined
      ? null
      : {
          type: "input",
          name: "primaryKeyNames",
          message:
            "What fallback primary key names should we use if no insert and update permissions?",
          initial: defaultConfigs.primaryKeyNames?.join(",") ?? "id",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "primaryKeyNames format is invalid";
            }
            return true;
          },
        },
    defaultConfigs.silent && defaultConfigs.headFields !== undefined
      ? null
      : {
          type: "input",
          name: "headFields",
          message:
            "What fields should we display first?",
          initial: defaultConfigs.headFields?.join(",") ?? "",
          result: parseArrayString,
          validate(value: string): string | boolean {
            if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
              return "headFields format is invalid";
            }
            return true;
          },
        },
    defaultConfigs.silent && defaultConfigs.tailFields !== undefined
    ? null
    : {
        type: "input",
        name: "tailFields",
        message:
          "What fields should we display last?",
        initial: defaultConfigs.tailFields?.join(",") ?? "",
        result: parseArrayString,
        validate(value: string): string | boolean {
          if (value && !PATTERN_NAMES_WITH_COMMA.test(value)) {
            return "tailFields format is invalid";
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

  if (actionArg) {
    console.log(`running command with action: ${actionArg}`);
  }
  
  const actionAnswer = actionArg ?? (await prompt<{ action: Action }>(actionQuestions)).action;
  const actions = parseActions(actionAnswer);

  const questions = (() => {
    switch (actionAnswer) {
      case "graphql":
        return [...sharedQuestions, ...graphqlQuestions];
      case "template":
        return [...sharedQuestions, ...templateQuestions];
      case "all":
        return [...sharedQuestions, ...graphqlQuestions, ...templateQuestions];
      default:
        throw new Error(`invalid action <${actionAnswer as string}>`)
    }
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalAnswer = await prompt<QuestionResult>(questions as any[]);

  return [
    actions,
    {
      ...defaultConfigs,
      ...finalAnswer,
    },
  ];
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

export default startPrompt;
