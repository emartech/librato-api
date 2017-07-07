module.exports = {
  "env": {
    "browser": true,
    "commonjs": true,
    "es6": true,
    "node": true,
    "mocha": true
  },
  "globals": {
    /** AngularJS inject */
    "inject": true,
    /** for client tests */
    "expect": true,
    "sinon": true
  },
  "extends": "eslint:recommended",
  "plugins": [
    /** https://www.npmjs.com/package/eslint-plugin-standard */
    "standard"
  ],
  "rules": {
    /** http://eslint.org/docs/rules/indent */
    "indent": [
      "error",
      2,
      { "SwitchCase": 1 }
    ],
    /** http://eslint.org/docs/rules/linebreak-style */
    "linebreak-style": [
      "error",
      "unix"
    ],
    /** http://eslint.org/docs/rules/quotes */
    "quotes": [
      "error",
      "single",
      { "avoidEscape": true, "allowTemplateLiterals": true }
    ],
    /** http://eslint.org/docs/rules/semi */
    "semi": [
      "error",
      "never"
    ],
    /** http://eslint.org/docs/rules/no-unused-vars */
    "no-unused-vars": [
      "error",
      { "vars": "all", "args": "none", "ignoreRestSiblings": false }
    ],
    /** http://eslint.org/docs/rules/no-var */
    "no-var": "error",
    /** https://www.npmjs.com/package/eslint-plugin-standard */
    "standard/object-curly-even-spacing": ["error", "either"],
    /** https://www.npmjs.com/package/eslint-plugin-standard */
    "standard/array-bracket-even-spacing": ["error", "either"],
    /** https://www.npmjs.com/package/eslint-plugin-standard */
    "standard/computed-property-even-spacing": ["error", "even"],
    "require-yield": "off"
  }
};
