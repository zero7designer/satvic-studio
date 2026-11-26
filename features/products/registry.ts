export type ProductId = 'satvic-fluid';

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
  groups: { label: string; features: ProductFeature[] }[];
};

export const products: ProductDefinition[] = [
  {
    id: 'satvic-fluid',
    name: 'Satvic Studio',
    description: 'Language QA',
    href: '/dashboard/satvic-fluid',
    groups: [
      { label: '', features: [
        { id: 'generate-sarvam', label: 'Generate with Sarvam', icon: 'plus' },
        { id: 'start-review', label: 'Start a review', icon: 'workflow' },
        { id: 'cost-estimate', label: 'Cost estimate', icon: 'calculator' },
      ] },
    ],
  },
];

export function getProduct(productId: string) {
  return products.find(product => product.id === productId);
}
