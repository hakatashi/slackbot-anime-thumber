const scrapeIt = require('scrape-it');
const fs = require('fs-extra');
const axios = require('axios');
const qs = require('querystring');
const {get} = require('lodash');

(async () => {
	const tsv = await fs.readFile('lives.tsv');
	const proceeded = new Set(tsv.toString().split('\n').map((line) => line.split('\t')[1]));
	const writer = fs.createWriteStream('lives.tsv', {flags: 'a'});

	{
		const dirs = await fs.readdir('raw-thumbs/lives');
		const lives = new Set(dirs.map((dir) => dir.split('-')[0]));

		for (const liveId of lives) {
			if (proceeded.has(liveId)) {
				continue;
			}
			let count = '';
			if (await fs.pathExists(`webp/lives/${liveId}`)) {
				count = (await fs.readdir(`webp/lives/${liveId}`)).length.toString();
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const {data} = await scrapeIt(`https://live.nicovideo.jp/gate/${liveId}`, {
				title: {
					selector: 'meta[property="og:title"]',
					attr: 'content',
				},
				channel: '[itemtype="http://schema.org/Organization"] > a',
			});

			console.log(data);
			writer.write([
				'lives',
				liveId,
				data.title,
				data.channel,
				count,
			].join('\t') + '\n');
		}
	}

	{
		const videos = await fs.readdir('raw-thumbs/youtube');

		for (const videoId of videos) {
			if (proceeded.has(videoId)) {
				continue;
			}
			let count = '';
			if (await fs.pathExists(`webp/youtube/${videoId}`)) {
				count = (await fs.readdir(`webp/youtube/${videoId}`)).length.toString();
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const {data} = await axios.get(`https://content.googleapis.com/youtube/v3/videos?${qs.encode({
				part: 'snippet',
				id: videoId,
				key: process.env.YOUTUBE_API_KEY,
			})}`);

			console.log(data);
			writer.write([
				'youtube',
				videoId,
				get(data, ['items', 0, 'snippet', 'title'], ''),
				get(data, ['items', 0, 'snippet', 'channelTitle'], ''),
				count,
			].join('\t') + '\n');
		}
	}

	{
		const videos = await fs.readJSON('uploaded.json');
		const infos = await fs.readJSON('niconico.json');

		for (const video of videos) {
			const [, videoId] = video.split('/');
			if (proceeded.has(videoId)) {
				continue;
			}
			let count = '';
			if (await fs.pathExists(`raw-thumbs/niconico/${videoId}`)) {
				count = (await fs.readdir(`raw-thumbs/niconico/${videoId}`)).length.toString();
			}
			const info = infos.find((i) => i.videoId === videoId);
			if (!info) {
				continue;
			}
			const components = info.path.split('\\');
			const dirname = components[components.length - 2].replace(/_/g, ' ').trim();
			const filename = components[components.length - 1].replace(/-[^-]+$/, '').replace(/_/g, ' ').trim();

			writer.write([
				'niconico',
				videoId,
				filename,
				dirname,
				count,
			].join('\t') + '\n');
		}
	}

	writer.end();
})();