// Adapter between NuvioStreams' provider interface and the original,
// proven 4KHDHub-Nick PlayIMDb implementation.
//
// Stremio calls TV content "series"; the original PlayIMDb module expects "tv".
const playimdb = require('../playimdb');

async function getPlayIMDbStreams(tmdbId, mediaType, season, episode) {
  if (!playimdb || typeof playimdb.getStreams !== 'function') {
    console.error('[PlayIMDb adapter] Original getStreams() export is unavailable.');
    return [];
  }

  const normalizedType = mediaType === 'movie' ? 'movie' : 'tv';
  const seasonNumber = season == null ? null : Number(season);
  const episodeNumber = episode == null ? null : Number(episode);

  if (normalizedType === 'tv' &&
      (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber))) {
    console.warn('[PlayIMDb adapter] TV request is missing a valid season or episode.');
    return [];
  }

  console.log(
    `[PlayIMDb adapter] Calling original provider: type=${normalizedType}, season=${seasonNumber}, episode=${episodeNumber}`
  );

  return playimdb.getStreams(
    String(tmdbId),
    normalizedType,
    normalizedType === 'tv' ? seasonNumber : null,
    normalizedType === 'tv' ? episodeNumber : null
  );
}

module.exports = { getPlayIMDbStreams };
