const { supabase } = require('../config/supabase');
const path = require('path');

/**
 * Submit KYC Application (Supports Aadhaar, PAN, and Passport)
 */
const submitKYC = async (req, res) => {
  try {
    const { document_type, name, dob } = req.body;
    const userId = req.user.id;
    const files = req.files;

    if (!document_type || !name || !dob) {
      return res.status(400).json({ success: false, message: 'Mandatory fields missing.' });
    }

    const uploadToStorage = async (file, prefix) => {
        const fileName = `${userId}/${prefix}_${Date.now()}${path.extname(file.originalname)}`;
        const { data, error } = await supabase.storage.from('kyc-documents').upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });
        if (error) throw error;
        return data.path;
    };

    let kycData = {
        user_id: userId,
        document_type,
        name,
        dob,
        status: 'pending',
        created_at: new Date()
    };

    if (document_type === 'aadhaar') {
        const { aadhaar_number, address_line1, address_line2, address_line3, pincode } = req.body;
        
        // Validation: 12 digits numbers only
        const cleanAadhaar = (aadhaar_number || '').replace(/\s/g, '');
        if (!/^\d{12}$/.test(cleanAadhaar)) {
            return res.status(400).json({ success: false, message: 'Aadhaar must be 12 digits.' });
        }

        const front = files['front'] ? files['front'][0] : null;
        const back = files['back'] ? files['back'][0] : null;
        const full = files['full'] ? files['full'][0] : null;

        // Validation: Either (Front + Back) OR (Full only)
        if (!full && (!front || !back)) {
            return res.status(400).json({ success: false, message: 'Please upload Front + Back or Full Aadhaar.' });
        }

        // Masking: XXXX XXXX 1234
        kycData.aadhaar_number = `XXXX XXXX ${cleanAadhaar.slice(-4)}`;
        kycData.address_line1 = address_line1;
        kycData.address_line2 = address_line2;
        kycData.address_line3 = address_line3;
        kycData.pincode = pincode;

        if (front) kycData.front_image_url = await uploadToStorage(front, 'front');
        if (back) kycData.back_image_url = await uploadToStorage(back, 'back');
        if (full) kycData.full_image_url = await uploadToStorage(full, 'full');

    } else if (document_type === 'pan') {
        const { pan_number } = req.body;
        const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
        if (!panRegex.test((pan_number || '').toUpperCase())) {
            return res.status(400).json({ success: false, message: 'Invalid PAN format.' });
        }

        const panImage = files['full'] ? files['full'][0] : (files['front'] ? files['front'][0] : null);
        if (!panImage) return res.status(400).json({ success: false, message: 'PAN image missing.' });

        // Masking: XXXX1234X (Mask first 4, show next 4, mask last 2 or similar)
        // Rule: First 4 masked, next 4 visible, last 2 masked
        const maskedPan = `XXXX${pan_number.substring(4, 8)}${pan_number.substring(8).replace(/./g, 'X')}`;
        kycData.pan_number = maskedPan;
        kycData.pan_image_url = await uploadToStorage(panImage, 'pan');

    } else if (document_type === 'passport') {
        const { passport_number, nationality } = req.body;
        const passRegex = /^[A-Z]{1,2}[0-9]{6,7}$/i;
        if (!passRegex.test(passport_number)) {
            return res.status(400).json({ success: false, message: 'Invalid Passport format.' });
        }

        const front = files['front'] ? files['front'][0] : null;
        const full = files['full'] ? files['full'][0] : null;
        if (!front && !full) return res.status(400).json({ success: false, message: 'Passport front image mandatory.' });

        // Masking: XXXX1234 (Mask all but last 4)
        kycData.passport_number = `XXXX${passport_number.slice(-4)}`;
        kycData.nationality = nationality || '';
        
        if (front) kycData.front_image_url = await uploadToStorage(front, 'pass_front');
        const back = files['back'] ? files['back'][0] : null;
        if (back) kycData.back_image_url = await uploadToStorage(back, 'pass_back');
        if (full) kycData.full_image_url = await uploadToStorage(full, 'pass_full');
    }

    // Upsert into kyc_requests table
    const { error: dbError } = await supabase.from('kyc_requests').upsert(kycData, { onConflict: 'user_id' });
    if (dbError) return res.status(400).json({ success: false, message: dbError.message });

    // Update profile status to pending
    await supabase.from('profiles').update({ kyc_status: 'pending' }).eq('id', userId);

    // Initial Notification
    await supabase.from('notifications').insert({
        user_id: userId,
        type: 'kyc',
        title: 'KYC Submitted ⏳',
        message: 'Your documents have been submitted and are under review.'
    });

    res.json({ success: true, message: 'KYC submitted successfully!' });

  } catch (err) {
    console.error('KYC Controller Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

const getAdminKYCList = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('kyc_requests')
            .select('*, profiles(username, player_id)')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        if (error) return res.status(400).json({ success: false, message: error.message });
        res.json({ success: true, kycs: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

const reviewKYC = async (req, res) => {
    try {
        const { requestId, status, reason } = req.body; 
        if (!requestId || !status) return res.status(400).json({ success: false, message: 'Request ID and Status required.' });

        const { data: request, error: fetchErr } = await supabase.from('kyc_requests').select('user_id, document_type').eq('id', requestId).single();
        if (fetchErr || !request) return res.status(404).json({ success: false, message: 'KYC Request not found.' });

        const userId = request.user_id;

        // Update KYC Request Status
        await supabase.from('kyc_requests').update({ 
            status, 
            rejection_reason: status === 'rejected' ? reason : '' 
        }).eq('id', requestId);

        // Update User Profile
        const profileUpdates = { 
            kyc_status: status === 'approved' ? 'verified' : 'rejected',
            kyc_rejection_reason: status === 'rejected' ? (reason || 'Details not matching') : ''
        };
        const { error: profErr } = await supabase.from('profiles').update(profileUpdates).eq('id', userId);
        if (profErr) return res.status(400).json({ success: false, message: 'Profile update failed: ' + profErr.message });

        // Trigger Notifications
        const title = status === 'approved' ? 'KYC Verified ✅' : 'KYC Rejected ❌';
        let message = '';
        
        if (status === 'approved') {
            message = `Congratulations! Your identity is verified. Wallet features are now unlocked.`;
        } else {
            // Specific rejection texts as per prompts
            if (request.document_type === 'passport') {
                message = 'Passport KYC Rejected – Retry';
            } else if (request.document_type === 'pan') {
                message = 'Invalid PAN details';
            } else {
                message = `Reason: ${reason || 'Details mismatch. Please re-submit with correct information.'}`;
            }
        }

        await supabase.from('notifications').insert({
            user_id: userId,
            type: 'kyc',
            title,
            message
        });

        // Real-time update via Socket.io
        const io = req.app.get('io');
        if (io) {
            const { userToSocket } = require('../socket/socket.js');
            const targetSocket = userToSocket.get(userId);
            if (targetSocket) io.to(targetSocket).emit('silent_notification');
        }

        res.json({ success: true, message: `KYC has been ${status}.` });
    } catch (err) {
        console.error('Review KYC Error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

module.exports = { submitKYC, getAdminKYCList, reviewKYC };

