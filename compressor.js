const Rembrandt = require('rembrandt');
const fs = require('fs-extra');
const path = require('path');
const {aperture, groupBy} = require('ramda');
const {default: Queue} = require('p-queue');
const {spawn} = require('child_process');
const concatStream = require('concat-stream');

const queue = new Queue({concurrency: 1});
const webpQueue = new Queue({concurrency: 5});

const exec = async (command, args) => {
	console.log(`$ ${command} ${args.join(' ')}`);

	const proc = spawn(command, args);

	const [stdout] = await Promise.all([
		new Promise((resolve) => {
			proc.stdout.pipe(concatStream({encoding: 'buffer'}, (data) => {
				resolve(data);
			}));
		}),
		new Promise((resolve, reject) => {
			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					console.error(`Non-Zero exit code: ${code}`);
					reject(`Non-Zero exit code: ${code}`);
				}
			});
		}),
	]);

	return stdout;
};

const generateThumbs = (videoPath, eliminate = true) => {
	queue.add(async () => {
		const webps = await fs.readJson('webps.json').catch(() => []);
		
		const [type, id] = videoPath.split('/');
		if (webps.includes(videoPath)) {
			console.log(`Skipping ${videoPath}...`);
			return;
		}

		console.log(`Genarating thumbs for ${videoPath}...`);
		const dirs = await fs.readdir(`raw-thumbs/${type}`);
		dirs.sort();
		const liveDirs = dirs.filter((dir) => dir.startsWith(id));

		let offset = 0;

		for (const dir of liveDirs) {
			const blacklist = new Set();
			const itemPath = path.resolve(`raw-thumbs/${type}`, dir);
			const files = await fs.readdir(itemPath);
			files.sort();

			if (eliminate) {
				for (const [index, [imageA, imageB]] of aperture(2, files).entries()) {
					const rembrandt = new Rembrandt({
						imageA: path.resolve(itemPath, imageA),
						imageB: path.resolve(itemPath, imageB),
						thresholdType: Rembrandt.THRESHOLD_PERCENT,
						maxThreshold: 0.05,
						maxDelta: 20 / 255,
						maxOffset: 2,
						renderComposition: false,
					});

					const result = await rembrandt.compare();
					if (result.passed) {
						blacklist.add(imageA);
						blacklist.add(imageB);
					}

					if (index % 100 === 0) {
						console.log(`Elimination in progress... (${index}/${files.length})`);
					}
				}
			}

			await fs.mkdirp(path.resolve('webp', type, id));

			for (const [index, file] of files.entries()) {
				if (blacklist.has(file)) {
					continue;
				}

				webpQueue.add(async () => {
					await exec('cwebp', [
						'-q', '50',
						path.resolve(itemPath, file),
						'-o', path.resolve('webp', type, id, `${(offset + index).toString().padStart(4, '0')}.webp`),
					]);
				});
			}

			await webpQueue.onIdle();

			offset += files.length;
		}

		webps.push(videoPath);
		await fs.writeJson('webps.json', webps);
	});
};

module.exports = async () => {
	const dirs = await fs.readdir('raw-thumbs/lives');

	const lives = groupBy((dir) => {
		const [live] = dir.split('-');
		return live;
	}, dirs.filter((dir) => dir.startsWith('lv')).sort());
	for (const liveId of Object.keys(lives)) {
		generateThumbs(`lives/${liveId}`);
	}

	const youtubes = await fs.readdir('raw-thumbs/youtube');
	for (const videoId of youtubes) {
		generateThumbs(`youtube/${videoId}`, false);
	}
};

module.exports();