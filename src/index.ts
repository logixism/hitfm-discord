import { config } from "dotenv";
config();

import { Client, GatewayIntentBits } from "discord.js";
import { env } from "./config";
import { startRadio } from "./modules/radio";
import { startStatusLoop } from "./modules/status";

const client = new Client({
  intents: [
    Object.values(GatewayIntentBits).filter((x) => typeof x === "number"),
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  startRadio(client);
  startStatusLoop();
});

client.login(env.APP_TOKEN);
