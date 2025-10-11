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

const STREAM_VOLUME = 0.8;

// Timing configuration
const TIMINGS = {
  VOICE_CONNECT_TIMEOUT: 30000,
  DISCONNECT_DETECTION: 5000,
  MIN_RECONNECT_DELAY: 1000,
  MAX_RECONNECT_DELAY: 30000,
  STREAM_RESTART_DELAY: 2000,
  CLEANUP_DELAY: 100,
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

// Connection states
enum StreamerState {
  IDLE = "idle",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTING = "disconnecting",
  RECONNECTING = "reconnecting",
  DESTROYED = "destroyed",
}

export class RadioStreamer {
  private client: Client;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;

  // State management
  private state: StreamerState = StreamerState.IDLE;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private streamRestartTimeout: NodeJS.Timeout | null = null;
  private isReconnecting = false;
  private connectionListeners = new Map<string, (...args: any[]) => void>();
  private playerListeners = new Map<string, (...args: any[]) => void>();

  constructor(client: Client) {
    this.client = client;
    this.createPlayer();
  }

  private setState(newState: StreamerState): void {
    const oldState = this.state;
    this.state = newState;
    console.log(`[RadioStreamer] State transition: ${oldState} -> ${newState}`);
  }

  private createPlayer(): void {
    if (this.player) {
      this.cleanupPlayer();
    }

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    // Setup player event listeners
    const errorHandler = (err: Error) => {
      console.error("[RadioStreamer] Audio player error:", err);
      this.scheduleStreamRestart();
    };

    const idleHandler = () => {
      if (this.state === StreamerState.CONNECTED) {
        console.warn("[RadioStreamer] Player went idle, restarting stream...");
        this.scheduleStreamRestart();
      }
    };

    this.player.on("error", errorHandler);
    this.player.on(AudioPlayerStatus.Idle, idleHandler);

    // Store listeners for cleanup
    this.playerListeners.set("error", errorHandler);
    this.playerListeners.set(AudioPlayerStatus.Idle, idleHandler);

    console.log("[RadioStreamer] Audio player created");
  }

  private cleanupPlayer(): void {
    if (!this.player) return;

    // Remove all listeners
    this.playerListeners.forEach((handler, event) => {
      this.player?.off(event, handler);
    });
    this.playerListeners.clear();

    try {
      this.player.stop();
    } catch (err) {
      console.warn("[RadioStreamer] Error stopping player:", err);
    }

    this.player = null;
  }

  private async connectToVoiceChannel(): Promise<void> {
    if (
      this.state === StreamerState.CONNECTING ||
      this.state === StreamerState.RECONNECTING
    ) {
      console.warn(
        "[RadioStreamer] Already connecting, skipping duplicate attempt"
      );
      return;
    }

    this.setState(StreamerState.CONNECTING);

    try {
      const guild = await this.client.guilds.fetch(env.GUILD_ID);

      // Clean up existing connection
      if (this.connection) {
        await this.cleanupConnection();
      }

      // Create new connection
      this.connection = joinVoiceChannel({
        channelId: env.VOICE_CHANNEL_ID,
        guildId: env.GUILD_ID,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      this.setupConnectionListeners();

      // Wait for connection to be ready
      await entersState(
        this.connection,
        VoiceConnectionStatus.Ready,
        TIMINGS.VOICE_CONNECT_TIMEOUT
      );

      console.log("[RadioStreamer] Voice connection established");
      this.setState(StreamerState.CONNECTED);
      this.reconnectAttempts = 0;

      // Subscribe player and start stream
      if (this.player && this.connection) {
        this.connection.subscribe(this.player);
        this.startStream();
      }
    } catch (err) {
      console.error("[RadioStreamer] Failed to connect:", err);
      this.setState(StreamerState.IDLE);

      if (this.reconnectAttempts < TIMINGS.MAX_RECONNECT_ATTEMPTS) {
        this.scheduleReconnect();
      } else {
        console.error(
          "[RadioStreamer] Max reconnection attempts reached, giving up"
        );
        this.destroy();
      }

      throw err;
    }
  }

  private setupConnectionListeners(): void {
    if (!this.connection) return;

    // Clean up any existing listeners first
    this.cleanupConnectionListeners();

    // Disconnected handler - follows Discord.js guide pattern
    const disconnectHandler = async () => {
      if (
        this.state === StreamerState.DESTROYED ||
        this.state === StreamerState.DISCONNECTING
      ) {
        return;
      }

      console.warn("[RadioStreamer] Voice connection disconnected");

      try {
        // Check if it's reconnecting to a new channel
        await Promise.race([
          entersState(
            this.connection!,
            VoiceConnectionStatus.Signalling,
            TIMINGS.DISCONNECT_DETECTION
          ),
          entersState(
            this.connection!,
            VoiceConnectionStatus.Connecting,
            TIMINGS.DISCONNECT_DETECTION
          ),
        ]);
        console.log(
          "[RadioStreamer] Connection is reconnecting to new channel"
        );
      } catch {
        // Real disconnect that needs recovery
        console.log(
          "[RadioStreamer] Real disconnect detected, attempting recovery"
        );
        this.setState(StreamerState.IDLE);
        this.scheduleReconnect();
      }
    };

    // Destroyed handler
    const destroyedHandler = () => {
      if (this.state === StreamerState.DESTROYED) return;

      console.warn("[RadioStreamer] Connection destroyed unexpectedly");
      this.setState(StreamerState.IDLE);
      this.scheduleReconnect();
    };

    // Ready handler
    const readyHandler = () => {
      console.log("[RadioStreamer] Connection ready");
      if (this.state !== StreamerState.CONNECTED) {
        this.setState(StreamerState.CONNECTED);
      }
    };

    this.connection.on(VoiceConnectionStatus.Disconnected, disconnectHandler);
    this.connection.on(VoiceConnectionStatus.Destroyed, destroyedHandler);
    this.connection.on(VoiceConnectionStatus.Ready, readyHandler);

    // Store listeners for cleanup
    this.connectionListeners.set(
      VoiceConnectionStatus.Disconnected,
      disconnectHandler
    );
    this.connectionListeners.set(
      VoiceConnectionStatus.Destroyed,
      destroyedHandler
    );
    this.connectionListeners.set(VoiceConnectionStatus.Ready, readyHandler);
  }

  private cleanupConnectionListeners(): void {
    if (!this.connection) return;

    this.connectionListeners.forEach((handler, event) => {
      this.connection?.off(event as any, handler);
    });
    this.connectionListeners.clear();
  }

  private async cleanupConnection(): Promise<void> {
    if (!this.connection) return;

    this.cleanupConnectionListeners();

    // Give a small delay for cleanup
    await new Promise((resolve) => setTimeout(resolve, TIMINGS.CLEANUP_DELAY));

    try {
      this.connection.destroy();
    } catch (err) {
      console.warn("[RadioStreamer] Error destroying connection:", err);
    }

    this.connection = null;
  }

  private scheduleReconnect(): void {
    if (this.isReconnecting || this.state === StreamerState.DESTROYED) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff
    const delay = Math.min(
      TIMINGS.MIN_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      TIMINGS.MAX_RECONNECT_DELAY
    );

    console.log(
      `[RadioStreamer] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`
    );

    this.clearTimeouts();
    this.reconnectTimeout = setTimeout(async () => {
      this.isReconnecting = false;
      this.setState(StreamerState.RECONNECTING);

      try {
        await this.connectToVoiceChannel();
      } catch (err) {
        // Error already handled in connectToVoiceChannel
      }
    }, delay);
  }

  private scheduleStreamRestart(): void {
    if (this.streamRestartTimeout || this.state !== StreamerState.CONNECTED) {
      return;
    }

    this.streamRestartTimeout = setTimeout(() => {
      this.streamRestartTimeout = null;
      this.restartStream();
    }, TIMINGS.STREAM_RESTART_DELAY);
  }

  private restartStream(): void {
    if (this.state !== StreamerState.CONNECTED || !this.player) {
      return;
    }

    console.log("[RadioStreamer] Restarting stream...");

    try {
      this.player.stop();
    } catch (err) {
      console.warn("[RadioStreamer] Error stopping player:", err);
    }

    this.startStream();
  }

  private startStream(): void {
    if (
      !this.player ||
      !this.connection ||
      this.state !== StreamerState.CONNECTED
    ) {
      console.warn("[RadioStreamer] Cannot start stream: invalid state");
      return;
    }

    try {
      console.log("[RadioStreamer] Starting stream...");

      const resource = createAudioResource(env.STREAM_URL, {
        inlineVolume: true,
        inputType: StreamType.Arbitrary,
      });

      resource.volume?.setVolume(STREAM_VOLUME);
      this.player.play(resource);

      console.log("[RadioStreamer] Stream started successfully");
    } catch (err) {
      console.error("[RadioStreamer] Error starting stream:", err);
      this.scheduleStreamRestart();
    }
  }

  private clearTimeouts(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.streamRestartTimeout) {
      clearTimeout(this.streamRestartTimeout);
      this.streamRestartTimeout = null;
    }
  }

  public async start(): Promise<void> {
    if (
      this.state !== StreamerState.IDLE &&
      this.state !== StreamerState.DESTROYED
    ) {
      console.warn(`[RadioStreamer] Cannot start from state: ${this.state}`);
      return;
    }

    console.log("[RadioStreamer] Starting...");
    this.setState(StreamerState.IDLE);
    this.reconnectAttempts = 0;

    // Ensure player exists
    if (!this.player) {
      this.createPlayer();
    }

    try {
      await this.connectToVoiceChannel();
      console.log("[RadioStreamer] Started successfully");
    } catch (err) {
      console.error("[RadioStreamer] Failed to start:", err);
      // Reconnect will be scheduled by connectToVoiceChannel
    }
  }

  public async stop(): Promise<void> {
    console.log("[RadioStreamer] Stopping...");
    this.setState(StreamerState.DISCONNECTING);

    this.clearTimeouts();
    this.isReconnecting = false;

    // Clean up player
    if (this.player) {
      try {
        this.player.stop();
      } catch (err) {
        console.warn("[RadioStreamer] Error stopping player:", err);
      }
    }

    // Clean up connection
    await this.cleanupConnection();

    this.setState(StreamerState.IDLE);
    console.log("[RadioStreamer] Stopped");
  }

  public async destroy(): Promise<void> {
    console.log("[RadioStreamer] Destroying...");

    await this.stop();
    this.cleanupPlayer();

    this.setState(StreamerState.DESTROYED);
    console.log("[RadioStreamer] Destroyed");
  }

  public getState(): StreamerState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state === StreamerState.CONNECTED;
  }
}

// Singleton instance management
let streamerInstance: RadioStreamer | null = null;

export async function startRadio(client: Client): Promise<void> {
  // Clean up existing instance if it exists
  if (streamerInstance) {
    console.log("[RadioStreamer] Cleaning up existing instance...");
    await streamerInstance.destroy();
    streamerInstance = null;
  }

  // Create new instance
  streamerInstance = new RadioStreamer(client);

  try {
    await streamerInstance.start();
  } catch (err) {
    console.error("[RadioStreamer] Initial start failed:", err);
    // The streamer will handle reconnection internally
  }
}
