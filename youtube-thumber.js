const klaw = require('klaw');
const path = require('path');
const {spawn} = require('child_process');
const {default: Queue} = require('p-queue');
const fs = require('fs-extra');

(async () => {
	const files = await fs.readJson('youtube.json').catch(() => []);

	const queue = new Queue({concurrency: 1});

	const walker = klaw('C:\\Users\\denjj\\Videos\\animes');
	walker.on('data', async (item) => {
		if (!item.stats.isDirectory()) {
			const ext = path.extname(item.path);
			const basename = path.basename(item.path, ext);
			const videoId = basename.match(/-(.{11})$/)[1];

			if (files.some((file) => file.videoId === videoId)) {
				console.log('skipping...', {videoId});
				return;
			}

			await queue.add(async () => {
				console.log('proccessing...', {videoId});
				await fs.mkdirp(`raw-thumbs/youtube/${videoId}`);

				const args = [
					'-i', item.path,
					'-vf', 'fps=1/30,scale=-1:240',
					`raw-thumbs/youtube/${videoId}/%04d.png`,
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
			});

			files.push({videoId, ext, path: item.path});
			await fs.writeJson('youtube.json', files);
		}
	});
})();