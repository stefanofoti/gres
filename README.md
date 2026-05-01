# gres
The LTS lightweight integrated control pane.

Integrations:

- Home Assistant
- Jellyfin
- Proxmox
- Open Meteo
- Yahoo Finance

# Install

Download the [compose file](./docker-compose.prod.yaml) and launch the following:

```
docker compose -f docker-compose.prod.yaml up -d --pull always
```

## Structure

```
gres/
├── backend/
│   ├── server.js            # Express entry point
│   ├── data/                # JSON persistence
│   └── routes/
│       ├── settings.js      # CRUD settings
│       └── homeassistant.js # HA API proxy
└── frontend/
    ├── index.html
    ├── css/main.css
    └── js/app.js
```

## Development Setup

```bash
# 1. Copy the configuration file
cp .env.example .env

# 2. Edit PORT if necessary
nano .env

# 3. Install dependencies
npm install

# 4. Start
npm start
```

The app will be available at `http://localhost:3000`

## Home Assistant Configuration

1. Open the app → **Settings** tab
2. Enter your HA server URL (e.g: `http://192.168.1.100:8123`)
3. Enter the **Long-Lived Access Token**:
   - In HA: Profile → Security → Long-Lived Access Tokens → Create token
4. Click **Test connection** to verify
5. Save

## Jellyfin Configuration

1. Open the app → **Settings** tab
2. Enter your Jellyfin server URL (e.g: `http://192.168.1.100:8096`)
3. Enter the **API Token**:
   - In Jellyfin: Dashboard → API Keys → Create new key
4. Click **Test connection** to verify
5. Save

## Proxmox Configuration

1. Open the app → **Settings** tab
2. Enter your Proxmox server URL (e.g: `https://192.168.1.10:8006`)
3. Enter the **API Token ID** (format: user@realm!tokenname)
4. Enter the **API Token Secret**
   - In Proxmox: Datacenter → Permissions → API Tokens
5. Click **Test connection** to verify
6. Save

## Weather Configuration

1. Open the app → **Settings** tab → **Weather** section
2. Search for your default location (e.g., Milan, Rome, Turin)
3. Select the location
4. Click **Save default location**

## Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Read all settings |
| POST | `/api/settings` | Save settings (merge) |
| GET | `/api/ha/status` | Check HA connection |
| GET | `/api/ha/entities[?domain=]` | List smart-home entities |
| GET | `/api/ha/entity/:id` | Single entity state |
| POST | `/api/ha/service` | Execute HA service |
| GET | `/api/jf/status` | Check Jellyfin connection |
| GET | `/api/jf/items` | List Jellyfin library items |
| GET | `/api/jf/item/:id` | Get item details |
| GET | `/api/px/status` | Check Proxmox connection |
| GET | `/api/px/cluster/resources` | List cluster resources |
| GET | `/api/px/nodes/:node` | Node details |
| GET | `/api/px/qemu/:vmid` | VM details |
| POST | `/api/px/qemu/:vmid/status/:action` | VM actions (start/stop/etc.) |
| GET | `/api/weather/forecast` | Weather forecast |
| GET | `/api/markets/search?q=` | Search market symbols |
| GET | `/api/markets/quote/:symbol` | Get quote |
| GET | `/api/markets/chart/:symbol` | Get chart data |

### Service call example
```json
POST /api/ha/service
{
  "domain": "light",
  "service": "turn_on",
  "service_data": { "entity_id": "light.living_room" }
}
```

## Compatibility

- Pure ES5 (no transpiler needed)
- Wekkit on iOS 9+ ✓
