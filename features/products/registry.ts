export type ProductId = 'satvic-fluid' | 'video-manager';

export type ProductFeature = {
  id: string;
  label: string;
  icon: 'plus' | 'workflow' | 'calculator';
};

export type ProductDefinition = {
  id: ProductId;
  name: string;
  description: string;
  href: string;
  icon: 'audio' | 'plus';
  groups: { label: string; features: ProductFeature[] }[];
};

export const products: ProductDefinition[] = [
  {
    id: 'satvic-fluid',
    name: 'Satvic Studio',
    description: 'Language QA',
    href: '/dashboard/satvic-fluid',
    icon: 'audio',
    groups: [
      { label: '', features: [
        { id: 'generate-sarvam', label: 'Generate with Sarvam', icon: 'plus' },
        { id: 'start-review', label: 'Start a review', icon: 'workflow' },
        { id: 'cost-estimate', label: 'Cost estimate', icon: 'calculator' },
      ] },
    ],
  },
  {
    id: 'video-manager',
    name: 'Create Job',
    description: 'Video Manager',
    href: '/video-manager',
    icon: 'plus',
    groups: [
      { label: '', features: [
        { id: 'create-job', label: 'Create dub job', icon: 'plus' },
        { id: 'request-status', label: 'Request status', icon: 'workflow' },
      ] },
    ],
  },
];

export function getProduct(productId: string) {
  return products.find(product => product.id === productId);
}
