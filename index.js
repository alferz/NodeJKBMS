#!/usr/bin/env node
const cli = require('./cli');
const jkbms = require('./jkbms');
const logger = require('./logger');

async function main() {

	logger.info('Starting NodeJKBMS...');
	try {

		const args = cli.args;
		logger.trace(args, 'With arguments...')
		
		async function mainLoop() {
			//send requests, response handled by eventlistener
			await jkbms.getAllData();
			
			//wait 1s between requests
			await sleep(1000);
		};
		
		mainLoop();
		logger.info(`Polling BMS every ${args.pollinginterval} seconds...`);
		setInterval(
			mainLoop,
			args.pollinginterval * 1000
		);
	}
	catch(e) {
		logger.error(e);
		process.exit(1);
	}

}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

main();
