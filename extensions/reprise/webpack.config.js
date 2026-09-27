// webpack.config.js — bundle the extension for web (web worker target)
//@ts-check

'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'webworker',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'],
    extensions: ['.ts', '.js'],
    fallback: {
      // The extension uses no Node built-ins; don't polyfill them.
      path: false,
      buffer: false,
      process: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  performance: {
    hints: false,
  },
  devtool: 'nosources-source-map',
};

module.exports = config;
