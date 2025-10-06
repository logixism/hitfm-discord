import axios from "axios";
import z from "zod";
import { env } from "../config";

const SongSchema = z.object({
  time: z.string(),
  singer: z.string(),
  song: z.string(),
});

type Song = z.infer<typeof SongSchema>;

const SONG_DATA_URL = "https://o.tavrmedia.ua/hit";
const SONG_FETCH_INTERVAL_MS = 5_000;
const STATUS_UPDATE_INTERVAL_MS = 1_000;
const AD_STATUS = "Ad / talk break";

export class StatusUpdater {
  private lastStatusSet: string = "";
  private recentSongs: Song[] | null = null;
  private songFetchTimer: NodeJS.Timeout | null = null;
  private statusUpdateTimer: NodeJS.Timeout | null = null;

  constructor() {}

  private async fetchSongs(): Promise<Song[]> {
    try {
      const { data } = await axios.get(SONG_DATA_URL, {
        headers: {
          Accept: "application/json",
        },
      });

      try {
        const parsed = z.array(SongSchema).parse(data);
        return parsed;
      } catch (zErr) {
        console.error("Failed to parse songs:", zErr);
        console.error("Raw response data:", data);
        return [];
      }
    } catch (err) {
      console.error("Failed to fetch songs:", err);
      return [];
    }
  }

  private setChannelStatus(status: string): void {
    if (this.lastStatusSet === status) return;

    axios
      .put(
        `https://discord.com/api/v10/channels/${env.VOICE_CHANNEL_ID}/voice-status`,
        { status },
        {
          headers: {
            Authorization: `Bot ${env.APP_TOKEN}`,
          },
        }
      )
      .then(() => {
        this.lastStatusSet = status;
        console.log(`Status updated to: ${status}`);
      });
  }

  private updateStatus(): void {
    if (!this.recentSongs) return;

    const latestEntry = this.recentSongs[0];

    if (!latestEntry) return;

    const { singer, song } = latestEntry;

    if (singer === "Хіт FM") {
      return this.setChannelStatus(AD_STATUS);
    }

    this.setChannelStatus(`🎤 ${singer} - 💽 ${song}`);
  }

  public start(): void {
    const fetchHandler = () => {
      this.fetchSongs().then((data) => (this.recentSongs = data));
    };

    fetchHandler();
    this.songFetchTimer = setInterval(fetchHandler, SONG_FETCH_INTERVAL_MS);

    this.statusUpdateTimer = setInterval(
      () => this.updateStatus(),
      STATUS_UPDATE_INTERVAL_MS
    );
  }

  public stop(): void {
    if (this.songFetchTimer) {
      clearInterval(this.songFetchTimer);
      this.songFetchTimer = null;
    }
    if (this.statusUpdateTimer) {
      clearInterval(this.statusUpdateTimer);
      this.statusUpdateTimer = null;
    }
  }
}

export async function startStatusLoop(): Promise<StatusUpdater> {
  const updater = new StatusUpdater();
  updater.start();

  return updater;
}
