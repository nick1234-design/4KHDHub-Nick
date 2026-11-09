// Adapter between NuvioStreams' provider interface and the original
// 4KHDHub-Nick PlayIMDb implementation.
//
// IMPORTANT: Pass Stremio's original media type through unchanged.
// The original PlayIMDb module handles its own "movie", "series", and "tv"
// type detection. Converting "series" to "tv" here can change its behavior.
const playimdb = require('../playimdb');

async function getPlayIMDbStreams(tmdbId, mediaType, season, episode) {
  if (!playimdb || typeof playimdb.getStreams !== 'function') {
    console.error('[PlayIMDb adapter] Original getStreams() export is unavailable.');
    return [];
  }

  if (!tmdbId || !['movie', 'series', 'tv'].includes(mediaType)) {
    console.warn('[PlayIMDb adapter] Invalid request:', {
      hasTmdbId: Boolean(tmdbId),
      mediaType
    });
    return [];
  }

  const seasonNumber = season == null ? null : Number(season);
  const episodeNumber = episode == null ? null : Number(episode);

  if ((mediaType === 'series' || mediaType === 'tv') &&
      (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber))) {
    console.warn('[PlayIMDb adapter] TV request is missing a valid season or episode.');
    return [];
  }

  console.log(
    `[PlayIMDb adapter] Passing original request through: type=${mediaType}, season=${seasonNumber}, episode=${episodeNumber}`
  );

  return playimdb.getStreams(
    String(tmdbId),
    mediaType,
    seasonNumber,
    episodeNumber
  );
}

module.exports = { getPlayIMDbStreams };
