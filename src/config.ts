import z from "zod/v4";

const EnvSchema = z.object({
  APP_TOKEN: z.string().min(1),
  GUILD_ID: z.string().min(1),
  VOICE_CHANNEL_ID: z.string().min(1),
});

export const env = EnvSchema.parse(process.env);

export const config = {
  STREAM_URL: "https://tavr.tvstitch.com/HitFM_Ukr_HD",
  TAVR_API_STATUS_URL: "https://o.tavrmedia.ua/hitu",
};
