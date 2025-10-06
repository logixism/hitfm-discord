import axios from "axios";
import z from "zod";
import { env } from "../config";

// api is apparently extremely stupid, returns all kinda shit at once
const SongSchema = z.object({
  time: z.string(),
  singer: z.string(),
  song: z.string(),
});
const DjSchema = z.object({
  djType: z.string(),
  img: z.string().optional(),
  absnum: z.string().optional(),
  title: z.string(),
  cur_time: z.string(),
  end_time: z.string().optional(),
  link: z.string().optional(),
});

type Song = z.infer<typeof SongSchema>;
type DjInfo = z.infer<typeof DjSchema>;

const SONG_DATA_URL = "https://o.tavrmedia.ua/hit";
const SONG_FETCH_INTERVAL_MS = 5_000;
const STATUS_UPDATE_INTERVAL_MS = 1_000;
const AD_STATUS = "Ad / talk break";

export class StatusUpdater {
  private lastStatusSet = "";
  private latestSong: Song | null = null;
  private latestDj: DjInfo | null = null;
  private songFetchTimer: NodeJS.Timeout | null = null;
  private statusUpdateTimer: NodeJS.Timeout | null = null;

  private async fetchSongs(): Promise<void> {
    try {
      const { data } = await axios.get(`${SONG_DATA_URL}?_=${Date.now()}`, {
        headers: { Accept: "application/json" },
      });

      if (!Array.isArray(data)) {
        console.warn("Unexpected response format:", data);
        return;
      }

      let foundSong: Song | null = null;
      let foundDj: DjInfo | null = null;

      for (const item of data) {
        const songResult = SongSchema.safeParse(item);
        if (songResult.success) {
          foundSong = songResult.data;
          continue;
        }

        const djResult = DjSchema.safeParse(item);
        if (djResult.success) {
          foundDj = djResult.data;
        }
      }

      this.latestSong = foundSong;
      this.latestDj = foundDj;
    } catch (err) {
      console.error("Failed to fetch songs:", err);
    }
  }

  private setChannelStatus(status: string): void {
    if (this.lastStatusSet === status) return;

    axios
      .put(
        `https://discord.com/api/v10/channels/${env.VOICE_CHANNEL_ID}/voice-status`,
        { status },
        { headers: { Authorization: `Bot ${env.APP_TOKEN}` } }
      )
      .then(() => {
        this.lastStatusSet = status;
        console.log(`Status updated to: ${status}`);
      })
      .catch((err) => console.error("Failed to update status:", err));
  }

  private updateStatus(): void {
    const song = this.latestSong;
    const dj = this.latestDj;

    if (song) {
      if (song.singer === "Хіт FM") {
        return this.setChannelStatus(AD_STATUS);
      }
      return this.setChannelStatus(`🎤 ${song.singer} - 💽 ${song.song}`);
    }

    if (dj) {
      return this.setChannelStatus(`🎧 ${dj.title} (${dj.cur_time})`);
    }
  }

  public start(): void {
    const fetchHandler = () => this.fetchSongs();

    fetchHandler();
    this.songFetchTimer = setInterval(fetchHandler, SONG_FETCH_INTERVAL_MS);
    this.statusUpdateTimer = setInterval(
      () => this.updateStatus(),
      STATUS_UPDATE_INTERVAL_MS
    );
  }

  public stop(): void {
    if (this.songFetchTimer) clearInterval(this.songFetchTimer);
    if (this.statusUpdateTimer) clearInterval(this.statusUpdateTimer);
  }
}

export async function startStatusLoop(): Promise<StatusUpdater> {
  const updater = new StatusUpdater();
  updater.start();
  return updater;
}
