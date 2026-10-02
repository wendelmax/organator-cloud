// Config compartilhada entre os testes unitários e e2e da API.
// O ts-jest pode ser instalado na raiz do monorepo (hoisting do npm). A opção
// `compiler` faz o language service usar o TypeScript desta app, mas partes do
// ts-jest fazem require("typescript") direto e podem pegar o da raiz — por isso
// o tsconfig da API também precisa ser válido no TypeScript 5.x (sem
// opções que exijam ignoreDeprecations do TS 6).
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
