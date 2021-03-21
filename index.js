const Spotify = require("spotify-web-api-node");
const fs = require("fs");
const config = require("./config.json");

const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout
});

const id = (process.argv[2] || "").replace("spotify:playlist:", "");

if (!id) {
  console.log("Usage: node index.js [SPOTIFY_URI]");
  process.exit();
}

const client = new Spotify(config);
const url = client.createAuthorizeURL(["playlist-modify-private", "playlist-read-private", "playlist-modify-public", "playlist-read-collaborative"]);

async function main() {
  const { access_token, refresh_token } = await getTokens();
  client.setAccessToken(access_token);
  client.setRefreshToken(refresh_token);

  const me = await client.getMe().catch(async () => {
    const res = await client.refreshAccessToken();
    client.setAccessToken(res.body.access_token);
    writeConfig({ access_token: client.getAccessToken(), refresh_token: client.getRefreshToken() });
    return await client.getMe();
  });

  console.info(`Connected to spotify as ${me.body.display_name}`);

  console.info("Fetching playlist info...");
  const {
    body: { name, description, collaborative, public: isPublic }
  } = await client.getPlaylist(id).catch(err => {
    console.log(err);
    console.log(`No playlist with id ${id} found.`);
    process.exit();
  });

  console.info(`Found playlist "${name}". Fetching tracks...`);
  const tracks = await getPlaylistTracks(id);

  console.info("Shuffling playlist tracks...");
  shuffleArray(tracks);

  const newName = name + "-shuffled";
  console.info(`Creating new playlist "${newName}"...`);
  const newPlaylist = await client.createPlaylist(newName, {
    collaborative,
    description,
    public: isPublic
  });

  const songsChunked = chunkArray(tracks, 100);

  console.info(`Adding shuffled tracks to "${newName}"...`);
  for (const chunk of songsChunked) {
    await client.addTracksToPlaylist(newPlaylist.body.id, chunk);
  }

  console.info(`All done!`);
}

function chunkArray(array, chunkSize) {
  return array.reduce((prev, curr, index) => {
    const chunkIndex = Math.floor(index / chunkSize);
    prev[chunkIndex] ||= [];
    prev[chunkIndex].push(curr);
    return prev;
  }, []);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function getPlaylistTracks(id) {
  let tracks = [],
    offset = 0,
    nextSong = null;

  do {
    const {
      body: { limit, items, next }
    } = await client.getPlaylistTracks(id, { offset });
    offset += limit;
    nextSong = next;
    tracks = tracks.concat(items.map(i => i.track.uri));
  } while (nextSong);

  return tracks;
}

function prompt(question) {
  return new Promise(resolve => readline.question(question, resolve));
}

function writeConfig({ access_token, refresh_token }) {
  fs.writeFileSync("./tokens.json", JSON.stringify({ access_token, refresh_token }, null, 4));
}

async function getTokens() {
  console.info("Authorising...");
  if (fs.existsSync("./tokens.json")) return require("./tokens.json");

  const code = await prompt(`Open the following url in your browser and accept. Then take the token from the url and paste it into the console\n${url}\n> `);

  const { body } = await client.authorizationCodeGrant(code);
  writeConfig(body);
  return body;
}

main().then(() => readline.close());
