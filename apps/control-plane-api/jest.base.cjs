// Config compartilhada entre os testes unitários e e2e da API.
// O ts-jest pode ser instalado na raiz do monorepo (hoisting do npm) e, de lá,
// resolveria o TypeScript da raiz em vez do desta app. Fixamos o compilador
// resolvido a partir deste diretório para usar sempre o TypeScript da API.
const compiler = require.resolve('typescript', { paths: [__dirname] });

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePaths: ['<rootDir>/../../../node_modules'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { compiler }],
  },
};
