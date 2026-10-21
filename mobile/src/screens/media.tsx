import React, { useState } from 'react';
import { Image, Modal, Text, TouchableOpacity, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { mediaUri } from '../api';
import { Sub, colors, day } from '../ui';

export interface MediaItem { id: string; type: 'IMAGE' | 'VIDEO'; caption?: string | null; activity?: string | null; createdAt: string }

function VideoBox({ id }: { id: string }) {
  const player = useVideoPlayer(mediaUri(id), (p) => { p.play(); });
  return <VideoView player={player} style={{ width: '100%', height: 320 }} nativeControls />;
}

export function Thumb({ item, onPress }: { item: MediaItem; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ width: '33.33%', aspectRatio: 1, padding: 2 }}>
      {item.type === 'IMAGE'
        ? <Image source={mediaUri(item.id)} style={{ flex: 1, borderRadius: 8, backgroundColor: '#eee' }} />
        : <View style={{ flex: 1, borderRadius: 8, backgroundColor: '#2d2a32', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 28 }}>▶</Text></View>}
    </TouchableOpacity>
  );
}

export function MediaGrid({ items, tagsOf }: { items: MediaItem[]; tagsOf?: (m: any) => string }) {
  const [open, setOpen] = useState<MediaItem | null>(null);
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{items.map((m) => <Thumb key={m.id} item={m} onPress={() => setOpen(m)} />)}</View>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={{ flex: 1, backgroundColor: '#000d', justifyContent: 'center', padding: 12 }}>
          {open ? (
            <>
              {open.type === 'IMAGE'
                ? <Image source={mediaUri(open.id)} style={{ width: '100%', height: 420 }} resizeMode="contain" />
                : <VideoBox id={open.id} />}
              <Text style={{ color: '#fff', fontWeight: '700', marginTop: 10 }}>{open.activity ?? 'Class moment'}</Text>
              {open.caption ? <Text style={{ color: '#ddd' }}>{open.caption}</Text> : null}
              <Text style={{ color: '#aaa', marginTop: 4 }}>{day(open.createdAt)}{tagsOf ? ` · ${tagsOf(open)}` : ''}</Text>
            </>
          ) : null}
          <TouchableOpacity onPress={() => setOpen(null)} style={{ alignSelf: 'center', marginTop: 20, padding: 12 }}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      {!items.length ? <Sub>No photos or videos yet</Sub> : null}
    </>
  );
}
