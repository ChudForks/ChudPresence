/// <reference path="../../../schemas/activity-api-v2.d.ts" />
ChudPresence.onUpdate(async () => {
  const title = ChudPresence.page.read('title');
  const player = ChudPresence.media.getAll().find(media => media.visible && !media.ended);
  if (typeof title !== 'string' || !title || !player) {
    await ChudPresence.clear();
    return;
  }
  const artwork = ChudPresence.page.read('artwork');
  await ChudPresence.report({
    kind: 'video',
    media: { title },
    playback: {
      state: player.paused ? 'paused' : 'playing',
      position: player.currentTime,
      duration: player.duration,
      rate: player.playbackRate,
    },
    ...(typeof artwork === 'string' ? { artwork: { large: artwork } } : {}),
  });
});
