import { memo, useState } from 'react';
import { getTechnologyLogo } from '../../utils/technology-logo-map.js';
import { getRoleOrCategoryIcon } from '../../utils/palette-roles.js';
import { CatalogService } from '../../services/CatalogService.js';
import { LucideIcon, isLucideIconName } from './LucideIcon.js';

interface NodeIconProps {
  nodeType: string;
  technology?: string;
  /** Historically an emoji slot; container/role icon names are LUCIDE names ('box',
   *  'hexagon', 'package') and render as icons — never as literal text or emoji. */
  emojiIcon?: string;
  size?: number;
  position?: 'center' | 'top-left';
}

// N4.5 (bench-found: structure nodes rendered broken/nothing on canvas) established the
// logo→lucide chain with img error handling and no emoji.
// N4.8 (owner: "for nodes missing brand/stored iconography in our storage or database
// reference, defer to their parent category node-type iconography. No emojicons"):
// the chain now degrades through the ontology instead of collapsing to a generic box —
//   brand logo (storage / DB reference)
//   → the caller's icon name, when it is a real lucide name
//   → the node's ROLE icon (catalog icon_name)
//   → the role's PALETTE CATEGORY icon (the "parent category node-type")
//   → generic box.
// An emoji value never renders at any step.
function NodeIconComponent({ nodeType, technology, emojiIcon, size = 24, position = 'center' }: NodeIconProps) {
  const [imgFailed, setImgFailed] = useState(false);
  // Platform containers dropped role-first carry no technology binding, but every
  // brand platform's technology row shares its role id (aws, gcp, azure, supabase) —
  // the nodeType fallback keeps their stored brand logo on the container chrome.
  const iconPath = getTechnologyLogo(technology) ?? getTechnologyLogo(nodeType);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    ...(position === 'top-left' && {
      position: 'absolute',
      top: '8px',
      left: '8px',
    }),
  };

  if (iconPath && !imgFailed) {
    return (
      <div style={containerStyle}>
        <img
          src={iconPath}
          alt={nodeType}
          onError={() => setImgFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain'
          }}
        />
      </div>
    );
  }

  if (isLucideIconName(emojiIcon)) {
    return (
      <div style={containerStyle}>
        <LucideIcon name={emojiIcon} size={size} />
      </div>
    );
  }

  // No brand logo and no usable caller icon: degrade through the ontology —
  // role icon, then the role's palette-category icon, then the generic box.
  const role = CatalogService.getRoleForNodeType(nodeType);
  const FallbackIcon = getRoleOrCategoryIcon(role?.iconName, role?.paletteCategory);
  return (
    <div style={containerStyle}>
      <FallbackIcon size={size} strokeWidth={2} />
    </div>
  );
}

export const NodeIcon = memo(NodeIconComponent);
