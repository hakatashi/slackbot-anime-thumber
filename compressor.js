const Rembrandt = require('rembrandt');
const fs = require('fs-extra');
const path = require('path');
const {aperture, groupBy} = require('ramda');
const {default: Queue} = require('p-queue');
const {spawn} = require('child_process');
const concatStream = require('concat-stream');

const queue = new Queue({concurrency: 1});
const webpQueue = new Queue({concurrency: 5});
const uploadQueue = new Queue({concurrency: 1});

const exec = async (command, args, quiet = false) => {
	console.log(`$ ${command} ${args.join(' ')}`);

	const proc = spawn(command, args);

	if (!quiet) {
		proc.stdout.pipe(process.stdout);
		proc.stderr.pipe(process.stderr);
	}

	await Promise.all([
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
};

const upload = (videoPath) => {
	if (!videoPath.startsWith('niconico')) {
		return;
	}

	uploadQueue.add(async () => {
		const uploaded = await fs.readJson('uploaded.json').catch(() => []);
		if (uploaded.includes(videoPath)) {
			console.log(`Skipping upload of ${videoPath}...`);
			return;
		}

		console.log(`Uploading ${videoPath}...`);
		await exec('aws', [
			's3', 'sync',
			`webp/${videoPath}`,
			`s3://hakata-thumbs/${videoPath}`,
			'--acl', 'public-read',
			'--content-type', 'image/webp',
		]);

		uploaded.push(videoPath);
		await fs.writeJson('uploaded.json', uploaded);
	});
};

const generateThumbs = (videoPath, eliminate = true) => {
	queue.add(async () => {
		const webps = await fs.readJson('webps.json').catch(() => []);
		
		const [type, id] = videoPath.split('/');
		if (webps.includes(videoPath)) {
			upload(videoPath);
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
					], true);
				});
			}

			await webpQueue.onIdle();

			offset += files.length;
		}

		webps.push(videoPath);
		await fs.writeJson('webps.json', webps);

		upload(videoPath);
	});
};

module.exports = async () => {
	const dirs = await fs.readdir('raw-thumbs/lives').catch(() => []);

	const lives = groupBy((dir) => {
		const [live] = dir.split('-');
		return live;
	}, dirs.filter((dir) => dir.startsWith('lv')).sort());
	for (const liveId of Object.keys(lives)) {
		generateThumbs(`lives/${liveId}`);
	}

	const youtubes = await fs.readdir('raw-thumbs/youtube').catch(() => []);
	for (const videoId of youtubes) {
		generateThumbs(`youtube/${videoId}`, false);
	}

	const niconicos = await fs.readdir('raw-thumbs/niconico').catch(() => []);
	for (const videoId of niconicos) {
		generateThumbs(`niconico/${videoId}`, false);
	}
};

module.exports();
