import render from "hygen/dist/render";
import execute from "hygen/dist/execute";
import type { RunnerConfig } from "hygen/dist/types";
import Logger from "hygen/dist/logger";
import fs from 'fs-extra'
import { ConfigResolver } from 'hygen/dist/config'

const configResolver = new ConfigResolver('.hygen.js', {
  exists: fs.exists,
  load: async (f) => await import(f),
  none: (_) => ({}),
});

const defaultConfigs: RunnerConfig = {
  cwd: process.cwd(),
  logger: new Logger(console.log.bind(console)), // eslint-disable-line no-console
  debug: !!process.env.DEBUG,
  exec: (action, body) => {
    const opts = body && body.length > 0 ? { input: body } : {}
    return require('execa').command(action, { ...opts, shell: true }) // eslint-disable-line @typescript-eslint/no-var-requires
  },
  createPrompter: () => require('enquirer'),
}

const renderTemplate = async (
  args: any,
  config: RunnerConfig,
): Promise<unknown> => {
  const options = {
    ...defaultConfigs,
    ...(await configResolver.resolve(process.cwd())),
    ...config,
  };

  return execute(await render(args, options), args, options)
};

export default renderTemplate;