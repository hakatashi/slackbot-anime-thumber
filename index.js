const klaw = require('klaw');
const path = require('path');
const {spawn} = require('child_process');
const {default: Queue} = require('p-queue');
const fs = require('fs-extra');

(async () => {
	const files = await fs.readJson('files.json').catch(() => []);

	const queue = new Queue({concurrency: 1});

	const walker = klaw('Z:\\kakorokuRecorder\\video\\channel');
	walker.on('data', async (item) => {
		if (!item.stats.isDirectory()) {
			const liveId = item.path.match(/lv\d{8,}/)[0];
			const ext = path.extname(item.path);
			const basename = path.basename(item.path, ext);
			const partMatches = basename.match(/(\d+)$/);
			const part = partMatches ? partMatches[1] : '0';
			const channelName = item.path.split(path.sep).slice(-2)[0];

			if (ext !== '.flv') {
				return;
			}

			if (files.some((file) => file.liveId === liveId && file.part === part)) {
				console.log('skipping...', {liveId, ext, part, channelName});
				return;
			}

			await queue.add(async () => {
				console.log('proccessing...', {liveId, ext, part, channelName});
				await fs.mkdirp(`raw-thumbs/${liveId}-${part}`);

				const args = [
					'-i', item.path,
					'-vf', 'fps=1/30,scale=-1:240',
					`raw-thumbs/${liveId}-${part}/%04d.png`,
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

			files.push({liveId, ext, part, channelName, path: item.path});
			await fs.writeJson('files.json', files);
		}
	});
})();