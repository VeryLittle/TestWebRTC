const path = require('path');

module.exports = {
	mode: "development",
	target: "web",
	entry: {
		index: path.resolve(__dirname, './src/index.js'),
	},
	module: {
		rules: [
			{
				test: /\.jsx$/,
				use: [
					{
						loader: 'babel-loader',
						options: {
							presets: [
								'solid'
							],
						},
					}
				]
			},
			{
				test: /\.js$/,
				use: {
					loader: 'babel-loader',
				}
			}
		],
	},
	resolve: {
		extensions: ['.js', '.jsx'],
	},
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, 'public/dist'),
	},
}