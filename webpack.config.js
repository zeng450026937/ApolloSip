const webpack = require('webpack');

const pkg = require('./package.json');
const year = new Date().getFullYear();
const banner = `Apollo version ${pkg.version}\n
Copyright (c) 2018-${year} Yealink Networks, Inc\n`;

module.exports = {
  entry : {
    'apollosip' : `${__dirname }/src/ApolloSip.js`
  },
  output : {
    path          : `${__dirname }/dist`,
    filename      : '[name].js',
    library       : 'ApolloSip',
    libraryTarget : 'umd'
  },
  mode   : 'development',
  module : {
    rules : [
      {
        test    : /\.js$/,
        exclude : /node_modules/,
        loader  : 'babel-loader',
        options : {
          presets : [ 'env' ]
        }
      },
      {
        test    : /\.pegjs$/,
        loader  : 'pegjs-loader',
        options : {
          'optimize' : 'size'
        }
      }
    ]
  },
  plugins : [
    new webpack.BannerPlugin({
      banner : banner
    })
  ]
};
