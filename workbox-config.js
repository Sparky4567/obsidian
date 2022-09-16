module.exports = {
	globDirectory: 'themes/terminal/static/assets',
	globPatterns: [
		'**/*.{woff,css,js}'
	],
	swDest: 'themes/terminal/static/assets/sw.js',
	ignoreURLParametersMatching: [
		/^utm_/,
		/^fbclid$/
	]
};