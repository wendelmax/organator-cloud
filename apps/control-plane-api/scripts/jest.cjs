// Executa o Jest de onde quer que o npm o tenha instalado (na app ou hoisted
// na raiz do monorepo). Caminhos fixos para node_modules quebram quando uma
// atualização muda o hoisting. Os argumentos de linha de comando são repassados.
require(require.resolve('jest/bin/jest'));
