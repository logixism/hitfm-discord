// written by gemini

function base64EncodeUTF8(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);

  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }

  let binary = "";
  const len = data.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

export function generateXSuperProperties(): string {
  const minBuild = 400000;
  const maxBuild = 500000;
  const clientBuildNumber =
    Math.floor(Math.random() * (maxBuild - minBuild + 1)) + minBuild;

  const clientLaunchId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });

  const props = {
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: "en-GB",
    has_client_mods: false,
    browser_user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    browser_version: "120.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: clientBuildNumber,
    client_event_source: null,
    client_launch_id: clientLaunchId,
    client_app_state: "unfocused",
  };

  const compactJson = JSON.stringify(props, null, 0);

  return base64EncodeUTF8(compactJson);
}
