import mongoose from 'mongoose';

const allocationSegmentSchema = new mongoose.Schema(
  {
    cowNumber: { type: Number, required: true, min: 1 },
    fromShare: { type: Number, required: true, min: 1, max: 7 },
    toShare: { type: Number, required: true, min: 1, max: 7 },
    shareNumbers: {
      type: [{ type: Number, min: 1, max: 7 }],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'shareNumbers must list each share index on this cow'
      }
    },
    shareCount: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const cowShareAssignmentSchema = new mongoose.Schema(
  {
    cowNumber: { type: Number, required: true, min: 1 },
    shareNumber: { type: Number, required: true, min: 1, max: 7 }
  },
  { _id: false }
);

const shareParticipantDetailSchema = new mongoose.Schema(
  {
    cowNumber: { type: Number, required: true, min: 1 },
    shareNumber: { type: Number, required: true, min: 1, max: 7 },
    name: { type: String, default: '', trim: true },
    contact: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    paymentReceived: { type: Boolean, default: false }
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    shares: { type: Number, required: true, min: 1 },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    /** One row per cow segment: range + explicit share indices on that cow */
    allocations: { type: [allocationSegmentSchema], default: [] },
    /** Flat list: every (cow, share) pair for this booking, in order */
    cowShareAssignments: { type: [cowShareAssignmentSchema], default: [] },
    /** One row per share slot (same order as cowShareAssignments): participant details */
    shareParticipantDetails: { type: [shareParticipantDetailSchema], default: [] }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

bookingSchema.pre('validate', function bookingAllocationConsistency(next) {
  const segs = this.allocations;
  const flat = this.cowShareAssignments;
  if (!segs?.length && this.shares > 0) {
    this.invalidate('allocations', 'allocations must include cow and share details');
    return next();
  }
  const sumSeg = segs.reduce((acc, s) => acc + (s.shareCount ?? 0), 0);
  if (sumSeg !== this.shares) {
    this.invalidate('allocations', 'total shareCount in allocations must equal shares');
    return next();
  }
  if (flat?.length !== this.shares) {
    this.invalidate('cowShareAssignments', 'cowShareAssignments length must equal shares');
    return next();
  }
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i];
    if (!s.shareNumbers?.length || s.shareCount !== s.shareNumbers.length) {
      this.invalidate('allocations', 'each segment must list shareNumbers and matching shareCount');
      return next();
    }
    if (s.fromShare !== s.shareNumbers[0] || s.toShare !== s.shareNumbers[s.shareNumbers.length - 1]) {
      this.invalidate('allocations', 'shareNumbers must match fromShare through toShare');
      return next();
    }
  }
  const det = this.shareParticipantDetails;
  if (Array.isArray(det) && det.length > 0) {
    if (det.length !== flat.length) {
      this.invalidate('shareParticipantDetails', 'must have one entry per share slot');
      return next();
    }
    for (let i = 0; i < flat.length; i += 1) {
      if (det[i].cowNumber !== flat[i].cowNumber || det[i].shareNumber !== flat[i].shareNumber) {
        this.invalidate('shareParticipantDetails', 'entries must align with cowShareAssignments order');
        return next();
      }
    }
  }
  next();
});

export const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
