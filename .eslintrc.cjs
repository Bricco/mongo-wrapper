/* eslint-env node */
module.exports = {
  extends: [
    'eslint:recommended', 
    'plugin:@typescript-eslint/recommended', 
    'plugin:prettier/recommended',
    'eslint-config-prettier'
  ],
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',    
    'simple-import-sort',
    'eslint-plugin-prettier',
  ],
  root: true,
  rules: {
    'arrow-body-style': ['error', 'as-needed'],
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      {
        allowExpressions: true,
      },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    camelcase: ['error', { properties: 'never', ignoreDestructuring: true }],
    curly: ['error', 'all'],
    'import/order': 'off',
    'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    'no-param-reassign': 'error',
    'prefer-template': 'error',
    'simple-import-sort/exports': 'error',
    'simple-import-sort/imports': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[object.property.name='constructor'][property.name='name']",
        message:
          "'constructor.name' is not reliable (can become 'E', 'P' and etc.) after production build (JavaScriptOptimizer).",
      },
    ]
  }
};
