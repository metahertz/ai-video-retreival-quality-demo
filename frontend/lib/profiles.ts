// Client-side mirror of backend/services/atlas.py PROFILES constant

export type ProfileKey =
  | '1024_float'
  | '512_float'
  | '256_float'
  | '1024_int8'
  | '1024_binary';

export interface Profile {
  label: string;
  dims: number;
  quantization: string | null;
  costNote: string;
  field: string;
  index: string;
}

export const PROFILES: Record<ProfileKey, Profile> = {
  '1024_float': {
    label: '1024D float32',
    dims: 1024,
    quantization: null,
    costNote: '1× baseline',
    field: 'embedding',
    index: 'vs_1024_float',
  },
  '512_float': {
    label: '512D float32',
    dims: 512,
    quantization: null,
    costNote: '~0.5× storage',
    field: 'embedding_512',
    index: 'vs_512_float',
  },
  '256_float': {
    label: '256D float32',
    dims: 256,
    quantization: null,
    costNote: '~0.25× storage',
    field: 'embedding_256',
    index: 'vs_256_float',
  },
  '1024_int8': {
    label: '1024D int8',
    dims: 1024,
    quantization: 'scalar',
    costNote: '~0.25× memory',
    field: 'embedding',
    index: 'vs_1024_int8',
  },
  '1024_binary': {
    label: '1024D binary',
    dims: 1024,
    quantization: 'binary',
    costNote: '~0.03× memory',
    field: 'embedding',
    index: 'vs_1024_binary',
  },
};

export const PROFILE_KEYS = Object.keys(PROFILES) as ProfileKey[];
