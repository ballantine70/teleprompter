// ============================================================
// Firebase Configuration
// ============================================================
// Follow these steps once to connect this app to Firestore:
//
// 1. Go to https://console.firebase.google.com
// 2. Click "Add project", name it (e.g. "teleprompter"), finish setup
//
// 3. Enable Firestore:
//    Build → Firestore Database → Create database
//    Choose "Start in production mode", pick a region, click Enable
//
// 4. Enable Anonymous Authentication:
//    Build → Authentication → Get started
//    Sign-in method tab → Anonymous → Enable → Save
//
// 5. Set Firestore security rules (Firestore → Rules tab):
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /users/{userId}/{document=**} {
//          allow read, write: if request.auth != null
//                             && request.auth.uid == userId;
//        }
//      }
//    }
//    Click "Publish"
//
// 6. Get your app credentials:
//    Project settings (gear icon) → General tab
//    → scroll to "Your apps" → click "</> Web"
//    → register the app → copy the firebaseConfig object below
//
// 7. Replace the placeholder values below and save.
// ============================================================

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
