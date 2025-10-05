import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import { env } from "../config";

const RADIO_URL = "https://online.hitfm.ua/HitFM_HD";
const RECONNECT_VOICE_DELAY_MS = 1000;
const INITIAL_CONNECT_RETRY_DELAY_MS = 5000;
const VOICE_CONNECT_TIMEOUT_MS = 5000;
const STREAM_VOLUME = 0.8;

export class RadioStreamer {
  private client: Client;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;

  constructor(client: Client) {
    this.client = client;
  }

  private async connectToVoiceChannel(): Promise<void> {
    console.log("Connecting to voice channel...");

    const guild = await this.client.guilds.fetch(env.GUILD_ID);
    const adapterCreator = guild.voiceAdapterCreator;

    try {
      this.connection?.destroy();
    } catch {
      // ignore destruction errors
    }
    this.connection = null;

    try {
      this.connection = joinVoiceChannel({
        channelId: env.VOICE_CHANNEL_ID,
        guildId: env.GUILD_ID,
        adapterCreator,
        selfDeaf: true,
      });

      this.setupConnectionListeners();

      await entersState(
        this.connection,
        VoiceConnectionStatus.Ready,
        VOICE_CONNECT_TIMEOUT_MS
      );

      console.log("Voice connection established.");

      if (this.player) {
        this.connection.subscribe(this.player);
        this.startStream();
      }
    } catch (err) {
      console.error("Failed to connect:", err);
      this.reconnect();
      throw err;
    }
  }

  private setupConnectionListeners(): void {
    if (!this.connection) return;

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn("Voice connection lost! Attempting to reconnect...");
      try {
        await entersState(
          this.connection!,
          VoiceConnectionStatus.Connecting,
          VOICE_CONNECT_TIMEOUT_MS
        );
      } catch {
        this.reconnect();
      }
    });

    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.warn("Connection destroyed, reconnecting...");
      this.reconnect();
    });
  }

  private reconnect(): void {
    console.log(
      `🔌 Reconnecting voice connection in ${RECONNECT_VOICE_DELAY_MS / 1000}s`
    );
    try {
      this.connection?.destroy();
    } catch {
      // ignore errors during destruction
    }
    this.connection = null;

    setTimeout(() => this.start(), RECONNECT_VOICE_DELAY_MS);
  }

  private createPlayer(): void {
    if (this.player) return;

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    this.player.on("error", (err) => {
      console.error("Audio player error:", err);
      this.restartStream();
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      console.warn("Player went idle — restarting stream...");
      this.restartStream();
    });
  }

  private restartStream(): void {
    console.log("Restarting stream...");
    try {
      this.player?.stop();
    } catch {} // ignore error if player is already stopped

    this.startStream();
  }

  private startStream(): void {
    if (!this.player || !this.connection) {
      console.warn("Cannot start stream: Player or Connection is missing.");
      return;
    }

    console.log("Starting stream...");

    const resource = createAudioResource(RADIO_URL, {
      inlineVolume: true,
      inputType: StreamType.Arbitrary,
    });
    resource.volume?.setVolume(STREAM_VOLUME);

    this.player.play(resource);
  }

  public async start(): Promise<void> {
    this.createPlayer();

    try {
      await this.connectToVoiceChannel();
      console.log("RadioStreamer is active and playing.");
    } catch {
      // if connectToVoiceChannel failed, it already called this.reconnect(),
      // which will retry the start() method after a delay.
    }
  }

  public stop(): void {
    console.log("Stopping RadioStreamer...");

    try {
      this.player?.stop();
      this.player = null;
    } catch {}

    try {
      this.connection?.destroy();
      this.connection = null;
    } catch {}

    console.log("RadioStreamer stopped.");
  }
}

export async function startRadio(client: Client) {
  const streamer = new RadioStreamer(client);

  try {
    await streamer.start();
  } catch (err) {
    console.error(
      `Initial connection attempt failed, will retry in ${
        INITIAL_CONNECT_RETRY_DELAY_MS / 1000
      }s`
    );
    setTimeout(() => streamer.start(), INITIAL_CONNECT_RETRY_DELAY_MS);
  }
}
