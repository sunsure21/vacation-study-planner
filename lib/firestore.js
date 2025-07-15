const admin = require('firebase-admin');

// Firebase Admin 초기화
if (!admin.apps.length) {
    try {
        // Vercel 환경에서는 환경변수로 서비스 계정 키를 받음
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
            : require('../config/firebase-service-account.json'); // 로컬 개발용

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID || 'your-project-id'
        });
    } catch (error) {
        console.error('Firebase 초기화 오류:', error);
    }
}

const db = admin.firestore();

// 사용자 데이터 저장
async function saveUserData(userEmail, dataType, data) {
    try {
        const userDoc = db.collection('users').doc(userEmail);
        await userDoc.collection('data').doc(dataType).set(data);
        return { success: true };
    } catch (error) {
        console.error('데이터 저장 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자 데이터 조회
async function getUserData(userEmail, dataType) {
    try {
        const doc = await db.collection('users').doc(userEmail).collection('data').doc(dataType).get();
        if (doc.exists) {
            return { success: true, data: doc.data() };
        } else {
            return { success: true, data: null };
        }
    } catch (error) {
        console.error('데이터 조회 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자의 모든 데이터 조회
async function getAllUserData(userEmail) {
    try {
        const snapshot = await db.collection('users').doc(userEmail).collection('data').get();
        const data = {};
        snapshot.forEach(doc => {
            data[doc.id] = doc.data();
        });
        return { success: true, data };
    } catch (error) {
        console.error('전체 데이터 조회 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자 데이터 삭제
async function deleteUserData(userEmail, dataType) {
    try {
        await db.collection('users').doc(userEmail).collection('data').doc(dataType).delete();
        return { success: true };
    } catch (error) {
        console.error('데이터 삭제 오류:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    saveUserData,
    getUserData,
    getAllUserData,
    deleteUserData
}; 