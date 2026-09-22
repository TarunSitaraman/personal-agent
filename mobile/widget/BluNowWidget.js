// The home-screen widget the user chose (mockup A2, "Orb and next"): Blu's orb on dark glass with
// what's next beside it. The orb opens Blu's input (blu://assistant — keyboard up, mic beside
// it); the text opens the Now screen (blu://now). Android widgets are RemoteViews: no animation,
// so the orb is a still frame of the app's shader.
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

const ORB = require('../assets/widget-orb.png');

const WHITE = 'rgba(255, 255, 255, 1)';
const LABEL = 'rgba(235, 238, 250, 0.66)';
const SUB = 'rgba(235, 238, 250, 0.74)';
const ACCENT = 'rgba(130, 169, 255, 1)';

export default function BluNowWidget({ snapshot }) {
  const s = snapshot || { state: 'loading' };
  const heading = s.state === 'signedOut' ? 'Blu' : s.next ? s.next.label : 'Today';
  const title = s.state === 'signedOut' ? 'Sign in to see what’s next'
    : s.state === 'loading' ? 'Loading…'
      : s.next ? s.next.title : 'Nothing open.';
  const sub = s.state === 'signedOut' ? 'Open the app once to connect'
    : s.next ? s.next.sub
      : s.state === 'ready' ? 'Tap the orb to tell Blu what’s next' : '';

  return (
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', flexDirection: 'row', alignItems: 'center',
        borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.17)',
        backgroundGradient: { from: '#1a2139', to: '#0b1125', orientation: 'TOP_BOTTOM' },
        paddingLeft: 6, paddingRight: 18, paddingVertical: 12,
      }}
    >
      <ImageWidget
        image={ORB}
        imageWidth={112}
        imageHeight={112}
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'blu://assistant' }}
        accessibilityLabel="Talk to Blu"
      />
      <FlexWidget
        style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center', paddingLeft: 8 }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'blu://now' }}
      >
        <TextWidget
          text={heading.toUpperCase()}
          style={{ fontSize: 11, fontFamily: 'Heros-Bold', letterSpacing: 0.12, color: LABEL }}
        />
        <TextWidget
          text={title}
          maxLines={3}
          truncate="END"
          style={{ fontSize: title.length > 40 ? 17 : 20, fontFamily: 'Heros-Bold', color: WHITE, marginTop: 4, marginBottom: 5 }}
        />
        {sub ? <TextWidget text={sub} maxLines={1} truncate="END" style={{ fontSize: 12.5, fontFamily: 'Heros-Regular', color: SUB }} /> : null}
        {s.countdown ? <TextWidget text={s.countdown} style={{ fontSize: 13, fontFamily: 'Heros-Bold', color: ACCENT, marginTop: 3 }} /> : null}
      </FlexWidget>
    </FlexWidget>
  );
}
