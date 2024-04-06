# UwU-Logs Uploader

Automatically upload your WoWCombatLog.txt to uwu-logs.xyz.

## Building

Simply run `npm build`. This process relies on SEA.

Explanation of the steps:

1. Bundle `node_modules` with `eslint`.
2. Copy `node.exe` as `uwu_upload.exe`.
3. Build SEA blob from `sea_config.json` and the bundle made in step #1.
4. Inject the SEA blob into the node executable (`uwu_upload.exe`).
5. Change the executable's icon with `winresourcer`.

## Installation

Place `uwu_upload.exe` in your WoW directory and run it to generate the default `uwu_settings.json`:

```json
{
  "path": "Logs",
  "filename": "WoWCombatLog.txt",
  "gameServer": "Warmane"
}
```

Run it again and it should upload your WoWCombatLog.txt to uwu-logs.xyz.