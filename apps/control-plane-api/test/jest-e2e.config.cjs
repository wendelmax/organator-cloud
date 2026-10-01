const base = require('../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
};
