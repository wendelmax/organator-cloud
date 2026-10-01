// O ts-jest pode ser instalado na raiz do monorepo (hoisting do npm) e, de lá,
// resolveria o TypeScript da raiz em vez do desta app. Fixamos o compilador
// resolvido a partir deste diretório para usar sempre o TypeScript da API.
const compiler = require.resolve('typescript', { paths: [__dirname] });

/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePaths: ['<rootDir>/../../../node_modules'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { compiler }],
  },
};

module.exports = {
  ...base,
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};

module.exports.base = base;
