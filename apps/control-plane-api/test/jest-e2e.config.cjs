const { base } = require('../jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
};
