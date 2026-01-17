# PlateScannerApp

A React Native Android application for scanning and managing license plates using camera OCR.

## Features

- 📷 **Camera Scanner** - Scan license plates using device camera with OCR
- ✏️ **Manual Entry** - Enter plates manually when scanning isn't possible
- 📋 **History** - View all saved plates with timestamps
- 🔴 **Duplicate Detection** - Alerts for previously scanned plates
- 💾 **Local SQLite Database** - All data stored locally on device

## Tech Stack

- React Native CLI 0.83+
- TypeScript
- react-native-vision-camera (Camera)
- @react-native-ml-kit/text-recognition (OCR)
- react-native-fs (File Management)
- @op-engineering/op-sqlite (Database)
- React Navigation (Navigation)
- GitHub Actions (CI/CD)

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- For local Android development: Android Studio with SDK 34+

### Installation

```bash
# Install dependencies
npm install

# For Android
cd android && ./gradlew clean && cd ..
npx react-native run-android
```

## Building Signed APK (CI/CD)

This project is configured to build signed APK files in GitHub Actions without requiring Android Studio locally.

### Step 1: Generate Keystore

Run this command locally to generate a keystore:

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore upload.keystore \
  -alias upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

You will be prompted for:
- Keystore password
- Key password (can be same as keystore password)
- Name, Organization, etc. (fill as appropriate)

### Step 2: Encode Keystore to Base64

```bash
base64 -i upload.keystore -o keystore_base64.txt
```

### Step 3: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

| Secret Name | Value |
|-------------|-------|
| `KEYSTORE_BASE64` | Contents of `keystore_base64.txt` |
| `KEYSTORE_PASSWORD` | Your keystore password |
| `KEY_ALIAS` | `upload` (or your chosen alias) |
| `KEY_PASSWORD` | Your key password |

### Step 4: Trigger Build

Push to `main` or `master` branch, or manually trigger the workflow.

The signed APK will be available in the workflow artifacts.

## Project Structure

```
PlateScannerApp/
├── src/
│   ├── components/
│   │   └── PlateItem.tsx       # Reusable plate list item
│   ├── screens/
│   │   ├── HomeScreen.tsx      # Camera scanner screen
│   │   ├── ManualEntryScreen.tsx # Manual entry screen
│   │   └── HistoryScreen.tsx   # History list screen
│   ├── services/
│   │   └── db.ts               # SQLite database service
│   └── types/
│       └── index.ts            # TypeScript interfaces
├── android/
│   ├── app/
│   │   ├── build.gradle        # Signing config for CI/CD
│   │   └── src/main/
│   │       └── AndroidManifest.xml # Camera permissions
├── .github/
│   └── workflows/
│       └── build_apk.yml       # GitHub Actions workflow
├── App.tsx                     # Navigation setup
└── package.json
```

## License

MIT
