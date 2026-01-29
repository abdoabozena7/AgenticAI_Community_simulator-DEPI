# Point of return Frontend

React + Vite UI for the multi-agent social simulation.

## Run locally

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:8080`.

## Configure backend URL

Set the API/WS base in `frontend/.env` if your backend is not on `http://localhost:8000`:

```sh
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```
