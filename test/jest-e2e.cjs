// archiver@8 (PROP-399 evidence package) and its zip-stream chain are ESM-only. Jest runs in CommonJS,
// so exactly those packages are transpiled to CommonJS; every other dependency is left untouched.
const ESM_ONLY_DEPENDENCIES = [
  'archiver',
  'is-stream',
  'zip-stream',
  'compress-commons',
  'crc32-stream',
]
const esmPattern = ESM_ONLY_DEPENDENCIES.join('|')

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  setupFiles: ['<rootDir>/test/setup-e2e-env.ts'],
  transform: {
    [`node_modules[\\/](?:.*[\\/])?(?:${esmPattern})[\\/].+\\.js$`]: [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
        },
        diagnostics: false,
      },
    ],
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: [
    `node_modules[\\/](?!(?:.*[\\/])?(?:${esmPattern})[\\/])`,
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}
