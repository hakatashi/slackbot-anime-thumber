const klaw = require('klaw');
const path = require('path');
const {spawn} = require('child_process');
const {default: Queue} = require('p-queue');
const fs = require('fs-extra');
const {last} = require('lodash');

(async () => {
	const files = await fs.readJson('niconico.json').catch(() => []);
	const uploaded = await fs.readJson('uploaded.json').catch(() => []);

	const queue = new Queue({concurrency: 1});

	const walker = klaw('Z:\\Hakatanimation\\video');
	walker.on('data', async (item) => {
		if (!item.stats.isDirectory() && item.path.match(/\.(mp4|flv)$/)) {
			const ext = path.extname(item.path);
			const basename = path.basename(item.path, ext);
			const videoId = last(basename.split('-'));

			if (files.some((file) => file.videoId === videoId)) {
				// console.log('skipping...', {videoId});
				return;
			}

			const videos = await fs.readdir(`raw-thumbs/niconico/${videoId}`).catch(() => []);
			if (videos.length >= 10 || uploaded.some((path) => path === `niconico/${videoId}`)) {
				files.push({videoId, ext, path: item.path});
				await fs.writeJson('niconico.json', files);
				return;
			}

			await queue.add(async () => {
				console.log('proccessing...', {videoId});
				await fs.mkdirp(`raw-thumbs/niconico/${videoId}`);

				const args = [
					'-i', item.path,
					'-vf', 'fps=1/15,scale=-1:240',
					`raw-thumbs/niconico/${videoId}/%04d.png`,
					'-y',
				];

				console.log(`$ ffmpeg ${args.join(' ')}`);

				const ffmpeg = spawn('ffmpeg', args);

				ffmpeg.stdout.pipe(process.stdout);
				ffmpeg.stderr.pipe(process.stderr);

				await new Promise((resolve, reject) => {
					ffmpeg.on('close', (code) => {
						if (code === 0) { 
							resolve();
						} else {
							console.error(`Non-Zero exit code: ${code}`);
							reject(`Non-Zero exit code: ${code}`);
						}
					});
				});

				console.log('done', {videoId});
			});

			files.push({videoId, ext, path: item.path});
			await fs.writeJson('niconico.json', files);
		}
	});
})();