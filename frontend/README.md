# Frontend

This directory contains the Teamisty React/Vite web application. Password signup asks for a username, email, and password, then signs the user in and loads their profile. The display name starts as the username.

For local signup and sign-in, start User & Team with its migrated database. Set `VITE_API_BASE_URL=http://localhost:3001` in `infra/compose/.env` for Compose or `frontend/.env.local` for Vite on the host. Open the frontend at `http://localhost:5173`, which is allowed by the default User & Team CORS configuration. When the gateway is available, set the variable to its public API base URL, including its API prefix.

The frontend keeps the access token in memory. It restores the session through the HTTP-only refresh cookie on reload, renews the access token after its lifetime, and revokes the refresh session on sign-out.

Google sign-in needs the OAuth client configured in User & Team. For local development, register the backend redirect URI `http://localhost:3001/auth/google/callback` with Google. Set the User & Team `GOOGLE_SIGN_IN_SUCCESS_URL` to `http://localhost:5173/auth/google/callback` so the browser returns to the frontend and restores the session. Use `localhost` consistently for the frontend and API during this flow.

## Local container verification

Build from the monorepo root so npm workspace files are available:

```bash
docker build \
  --file frontend/Dockerfile \
  --tag teamisty/frontend:local \
  .
```

Run the Vite development container and open the application:

```bash
docker run --rm --publish 5173:5173 teamisty/frontend:local
```

Browse to `http://localhost:5173`.

## UI design guidelines

The authentication screens share a responsive layout. Open `/sign-in` or `/sign-up` directly. The page shows a Kanban illustration and a white form card on desktop. Below 900px the form fills the space between the page margins. The illustration is decorative and hidden from assistive technology.

### Typography and colors

Use bundled **Google Sans**, followed by `system-ui` and `sans-serif`. Use weights 400–700 for body text, form controls, and headings as defined in the authentication layout.

| Purpose | Hex |
| --- | --- |
| Page background | `#F6F5FA` |
| Card and input surfaces | `#FFFFFF` |
| Primary text and button | `#1B1B1D` |
| Primary button hover | `#34313F` |
| Secondary text, muted text, and hints | `#4F4C5E`, `#5E5B6B`, `#6B6878` |
| Placeholder text | `#777484` |
| Input and secondary button borders | `#DAD8E0` |
| Divider | `#E6E4EC` |
| Yellow, purple, lavender, and pink accents | `#F7E3A1`, `#8F7CEF`, `#D5CEFA`, `#FAD3DD` |
| Kanban column background and heading | `#ECEAF6`, `#3F3B52` |

### Components and accessibility

- Use the bundled [Teamisty logo](src/assets/logo.png) inside the form card.
- Use 52px inputs and buttons with a 12px radius, and a white form card with a 24px radius and soft shadow.
- Keep form labels visible. Announce field errors and link them to their inputs. Placeholder text has at least 4.5:1 contrast on white.
- Keep Lucide icons for interface controls. Use the official multicolour Google mark on the Google sign-in button. [Google Identity branding guide](https://developers.google.com/identity/branding-guidelines)
- Use Animate UI for interface animations. Sign-in and signup open without entrance motion. Switching forms uses its entrance and height effects while keeping the Kanban illustration still. Follow the browser's reduced-motion preference. [Animate UI Effect](https://animate-ui.com/docs/primitives/animate-ui/effect) · [Animate UI Auto Height](https://animate-ui.com/docs/primitives/animate-ui/auto-height)
- Reuse shared tokens in `src/styles.css` and check layouts across desktop, tablet, and mobile.
