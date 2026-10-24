# Autograna no ar — passo a passo

O que falta para o app funcionar com **GitHub**, **Netlify**, **Firebase** e **Mercado Pago** (Pix e cartão), com os e-mails automáticos.
O endereço do site é `autograna-app.netlify.app`. Onde aparecer `SEU-PROJETO`, use o ID do projeto no Firebase.

## 0. O que já está pronto

O que eu já fiz no Netlify e no GitHub, e o que muda em relação ao site antigo.

### 0.1 Veja o que eu já deixei pronto

- **Netlify** (conta autograna11@gmail.com, time AutoGrana): o site **autograna-app** já existe, no endereço `https://autograna-app.netlify.app`. Só a versão publicada fica aberta ao público; as versões de teste pedem login no Netlify.
- Variáveis já criadas lá: **ADMIN_EMAILS** e **SMTP_USER** (autograna11@gmail.com), **PLAN_PRICE** (39.90), **TRIAL_DAYS** (3), **CONTATO_EMAIL** e **SUPORTE_EMAIL** (autograna11@gmail.com).
- **GitHub**: a sua conta **limagui1** está ligada ao Claude. Os arquivos do site estão prontos para subir assim que o repositório existir (etapa 1).
- **Dono do app**: **autograna11@gmail.com**. É com esse Google que você abre o painel e nunca é bloqueado.

### 0.2 Separe o que falta

- O Google **autograna11@gmail.com** (Firebase, Netlify e os e-mails do app) e o seu GitHub.
- A conta do **Mercado Pago** que vai receber o dinheiro.
- Um computador ajuda no Firebase e no Google Cloud, mas não é obrigatório.
- Uns 60 minutos.

### 0.3 Entenda o que acontece com o site antigo

O site antigo e o Firebase antigo continuam funcionando até você apagá-los. As contas e os dados do Firebase antigo **não** passam para o novo.

O vídeo e os banners mostram **autograna.netlify.app**, que ainda é o endereço do site antigo, por isso o novo ficou **autograna-app.netlify.app**. Se quiser o endereço do vídeo, apague o site antigo no Netlify antigo (**Project configuration → General → Danger zone → Delete project**) e me peça para renomear o novo. Se preferir manter autograna-app, me peça o final do vídeo com o endereço novo.

## 1. GitHub: o repositório

Você cria o repositório vazio; eu envio os arquivos.

### 1.1 Crie o repositório vazio e me avise

1. Entre no GitHub com a conta **limagui1** e abra [github.com/new](https://github.com/new).
2. Em **Repository name**, escreva `autograna`.
3. Marque **Private**.
4. Deixe desmarcados README, .gitignore e licença, e clique em **Create repository**.
5. Volte aqui no chat e me diga que criou. Eu envio todos os arquivos para ele.

### 1.2 Proteja a conta do GitHub

Ative a **verificação em duas etapas** em [Settings → Password and authentication](https://github.com/settings/security). O Netlify publica o que estiver nesse repositório, então essa conta protege o site também.

## 2. Firebase: login e banco de dados

Um projeto novo, no Google autograna11, no plano gratuito.

### 2.1 Crie o projeto

1. Abra [console.firebase.google.com](https://console.firebase.google.com) entrando com **autograna11@gmail.com**.
2. Clique em **Criar um projeto** e dê o nome `autograna`.
3. O Google Analytics pode ser desativado.
4. Clique em **Criar projeto**.

Anote o **ID do projeto**, que aparece embaixo do nome (ex.: autograna-1a2b3).

### 2.2 Dê nome ao login com Google

Clique na engrenagem e abra **Configurações do projeto → Geral**. Em **Nome voltado ao público**, escreva `Autograna`, escolha o e-mail de suporte e salve. É esse o nome que aparece quando a pessoa entra com o Google.

### 2.3 Ligue o login por e-mail e pelo Google

No menu, abra **Authentication → Vamos começar**. Na aba **Método de login**:

- **E-mail/senha**: ative e salve.
- **Adicionar novo provedor → Google**: ative, escolha o e-mail de suporte e salve.

Depois, na aba **Configurações**:

- Em **Política de senha**, exija no mínimo 8 caracteres. O cadastro do app já pede 8.
- Deixe ativada a **Proteção contra enumeração de e-mail**.

### 2.4 Crie o banco de dados e publique as regras

1. No menu, abra **Firestore Database → Criar banco de dados**.
2. Se perguntar a edição, escolha **Standard**.
3. No local, escolha **southamerica-east1 (São Paulo)**. Ele não muda depois.
4. Escolha **modo de produção** e clique em Criar.
5. Na aba **Regras**, apague o texto que estiver lá.
6. Abra [o arquivo firestore.rules no seu GitHub](https://github.com/limagui1/autograna/blob/main/firestore.rules) (depois que eu enviar os arquivos), copie com o botão de copiar e cole no Firebase.
7. Clique em **Publicar**.

Até a etapa 6 terminar, o app não carrega dados. Isso é normal.

### 2.5 Copie as chaves do site (FIREBASE_WEB_CONFIG)

1. Abra **Configurações do projeto → Geral**.
2. Em "Seus apps", clique no ícone **</>** (Web).
3. Dê o apelido `autograna-web` e **não** marque o Firebase Hosting.
4. Clique em **Registrar app**.
5. Vai aparecer um código com **const firebaseConfig = { apiKey: …, … }**. Copie esse bloco, do **{** até o **}**, e guarde num bloco de notas.

Esse bloco é a variável **FIREBASE_WEB_CONFIG** da etapa 5. Ele não é secreto: se preferir, mande para mim aqui que eu coloco no Netlify.

### 2.6 Gere a chave do servidor (FIREBASE_SERVICE_ACCOUNT)

1. Abra **Configurações do projeto → Contas de serviço**.
2. Clique em **Gerar nova chave privada** e depois em **Gerar chave**. Um arquivo .json é baixado.
3. Abra o arquivo num editor de texto (Bloco de Notas ou TextEdit) e copie tudo.

Esse conteúdo é a variável **FIREBASE_SERVICE_ACCOUNT**. Ele é secreto: cole só no Netlify, não mande para ninguém (nem para mim). Depois de colar, apague o arquivo.

## 3. Mercado Pago: receber Pix e cartão

A conta que recebe, a chave Pix, para onde vai o dinheiro e as chaves do app.

### 3.1 Deixe a conta pronta para receber

- Use a conta que vai receber o dinheiro: no seu **CPF** ou, se tiver, no **CNPJ/MEI**.
- Complete o cadastro e a **verificação de identidade**. O Mercado Pago pede documento e selfie para liberar os saques.
- Ative a **verificação em duas etapas** na segurança da conta.
- Nos dados do negócio, use o nome `Autograna`. É o nome que o cliente vê na fatura do cartão, e nome estranho na fatura é o principal motivo de contestação.

### 3.2 Cadastre a chave Pix

No app do Mercado Pago, abra **Pix → Minhas chaves → Cadastrar chave**. Pode ser e-mail, celular, CPF/CNPJ ou chave aleatória. Sem chave Pix, o app não consegue gerar o código Pix.

### 3.3 Escolha para onde vai o dinheiro

- As vendas caem no **saldo do Mercado Pago**.
- Para mandar para o seu banco, use **Transferir** e cadastre a sua conta bancária uma vez.
- O **Pix** cai na hora.
- Para o **cartão**, escolha nas tarifas e prazos da conta quando quer receber: receber na hora custa mais, e esperar mais dias custa menos.

### 3.4 Crie a aplicação

1. Abra [mercadopago.com.br/developers/panel/app](https://www.mercadopago.com.br/developers/panel/app) e clique em **Criar aplicação**.
2. Dê o nome `Autograna`.
3. No tipo, escolha **Pagamentos online** e marque que **não** usa plataforma de e-commerce.
4. Se perguntar o produto, escolha **Assinaturas**.
5. Aceite os termos e crie.

### 3.5 Copie as credenciais de produção

Dentro da aplicação, abra **Credenciais de produção**. Se aparecer **Ativar credenciais**, informe o ramo (software / serviços digitais), o site `https://autograna-app.netlify.app` e aceite.

Depois copie as duas:

- **Public Key** (começa com APP_USR-): é a variável **MP_PUBLIC_KEY**. Ela mostra os campos do cartão dentro do app, e ninguém precisa de conta no Mercado Pago.
- **Access Token** (começa com APP_USR-): é a variável **MP_ACCESS_TOKEN**. É secreto: cole só no Netlify.

O aviso de pagamento (webhook) fica para a etapa 6, depois que o site estiver no ar.

## 4. Gmail que manda os e-mails

Os avisos automáticos do teste e da assinatura saem do autograna11.

### 4.1 Ative a verificação em duas etapas

Entre com **autograna11@gmail.com** em [myaccount.google.com/security](https://myaccount.google.com/security) e ative a **verificação em duas etapas**. Essa conta abre o Firebase, o Netlify e o painel do app, então é a mais importante de proteger.

### 4.2 Crie a senha de app (SMTP_PASS)

1. Ainda no autograna11, abra [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. Dê o nome `Autograna` e clique em Criar.
3. Copie as **16 letras** que aparecem: elas são a variável **SMTP_PASS**, não a senha normal da conta.

O Gmail aguenta umas 500 mensagens por dia, o que sobra para começar. As respostas dos clientes chegam no autograna11.

## 5. Netlify: colocar no ar

Você cola o que é secreto e liga o site ao GitHub; o resto eu já fiz.

### 5.1 Cole as variáveis que faltam

Abra [as variáveis do site no Netlify](https://app.netlify.com/projects/autograna-app/configuration/env) (Project configuration → Environment variables). Para cada uma abaixo, clique em **Add a variable**, escreva o nome exatamente assim em **Key** e cole o valor. Nas marcadas como secretas, marque **Contains secret values** (se pedir um valor por ambiente, preencha **Production**).

| Nome | O que colocar |
|---|---|
| `FIREBASE_WEB_CONFIG` | O bloco **firebaseConfig** inteiro (etapa 2.5) |
| `FIREBASE_SERVICE_ACCOUNT` | **Secreta.** O conteúdo inteiro do arquivo .json (etapa 2.6) |
| `MP_ACCESS_TOKEN` | **Secreta.** O Access Token de produção (etapa 3.5) |
| `MP_PUBLIC_KEY` | A Public Key de produção (etapa 3.5) |
| `SMTP_PASS` | **Secreta.** A senha de app de 16 letras (etapa 4.2) |
| `EMPRESA_NOME` | Seu nome ou o nome da empresa (vai nos Termos e na Privacidade) |
| `EMPRESA_DOCUMENTO` | Seu CPF ou o CNPJ |
| `SUPORTE_WHATSAPP` | **Opcional:** o WhatsApp do botão "Falar com uma pessoa" do Copiloto, com DDD (ex.: 11999998888) |

As outras seis eu já criei. A **MP_WEBHOOK_SECRET** entra na etapa 6.3.

### 5.2 Ligue o site ao GitHub

Faça depois que eu avisar que os arquivos estão no GitHub.

1. Abra [a configuração de publicação do site](https://app.netlify.com/projects/autograna-app/configuration/deploys) e procure **Continuous deployment → Repository**.
2. Clique em **Link repository** e escolha **GitHub**.
3. Autorize o Netlify no GitHub. Pode escolher "Only select repositories" e marcar só o **autograna**.
4. Escolha **limagui1/autograna**, branch **main**. Não mexa nas configurações de build: elas vêm do arquivo netlify.toml.
5. Confirme. O Netlify começa a publicar sozinho.

Se não achar algum botão, me avise aqui que eu te guio.

### 5.3 Confira a publicação

- Em **Deploys**, espere aparecer **Published**.
- Abra o log: tem que aparecer **✔ Firebase configurado**.
- Se aparecer **✖ Falta a variável…**, confira a variável e clique em **Trigger deploy → Deploy project**.
- Se preferir, me peça aqui que eu confiro a publicação para você.

Sempre que mudar uma variável, ela só vale na próxima publicação: **Deploys → Trigger deploy → Deploy project**.

## 6. Ligar as pontas

Autorizar o endereço no Google e mandar os avisos do Mercado Pago para o site.

### 6.1 Autorize o endereço no Firebase

No Firebase, abra **Authentication → Configurações → Domínios autorizados → Adicionar domínio** e adicione `autograna-app.netlify.app`.

### 6.2 Autorize o endereço no Google (login no app instalado)

1. Entrando com o autograna11, abra [a página de credenciais do Google Cloud](https://console.cloud.google.com/apis/credentials?project=SEU-PROJETO) do seu projeto.
2. Em **IDs do cliente OAuth 2.0**, abra **Web client (auto created by Google Service)**.
3. Em **Origens JavaScript autorizadas → Adicionar URI**, coloque `https://autograna-app.netlify.app`
4. Em **URIs de redirecionamento autorizados → Adicionar URI**, coloque `https://autograna-app.netlify.app/__/auth/handler`
5. Clique em **Salvar**. Pode levar alguns minutos para valer.

### 6.3 Ligue os avisos de pagamento do Mercado Pago

1. Na aplicação do Mercado Pago, abra **Webhooks → Configurar notificações → Modo de produção**.
2. Em URL, coloque `https://autograna-app.netlify.app/.netlify/functions/mp-webhook`
3. Marque os eventos **Pagamentos** e **Planos e assinaturas** e salve.
4. Copie a **Assinatura secreta**.
5. No Netlify, crie a variável `MP_WEBHOOK_SECRET` com ela, marcando **Contains secret values**, e clique em **Trigger deploy**.

### 6.4 Confira o servidor

- Abra `https://autograna-app.netlify.app/.netlify/functions/billing`. Tem que aparecer `{"error":"Use POST."}`.
- No Netlify, em **Logs → Functions**, tem que aparecer **emails-agendados** com a etiqueta **Scheduled**. É ela que manda os e-mails sozinha, de hora em hora.

## 7. Testar

Como cliente, como dono, no iPhone e com pagamento.

### 7.1 Teste como cliente

1. Abra `https://autograna-app.netlify.app`, toque em **Testar grátis** e crie uma conta com outro e-mail seu (o principal serve).
2. O app deve abrir com o convite **"Seus 3 dias grátis começaram"**.
3. Toque em **Cadastrar cartão** só para ver os campos. Pode voltar sem cadastrar.

### 7.2 Teste como dono e receba os e-mails de exemplo

1. Entre com o Google **autograna11@gmail.com** e abra **Ajustes → Assinatura**. Deve aparecer "Conta do dono — acesso sempre liberado".
2. Toque em **Receber e-mails de exemplo**. Chegam 3 e-mails com "[Exemplo]" no assunto; olhe o spam também.
3. Em **Abrir painel de usuários**, você vê quem está usando e, mais tarde, por que não assinaram.

### 7.3 Instale no iPhone

1. No Safari, abra `https://autograna-app.netlify.app` e toque em **Compartilhar → Adicionar à Tela de Início**.
2. Abra pelo ícone e entre com o Google.
3. Passe pelas abas e toque em **+ Novo**: a barra de baixo e o topo ficam parados no lugar.

Se ainda estiver com o app antigo na tela, apague o ícone antigo.

### 7.4 Teste o cartão sem gastar (contas de teste)

1. Na aplicação do Mercado Pago, abra **Contas de teste** e crie um **vendedor** e um **comprador** do Brasil. Anote o e-mail do comprador.
2. Entre no Mercado Pago Developers com a conta de teste **vendedora**, crie uma aplicação nela e copie a Public Key e o Access Token de produção dessa aplicação.
3. No Netlify, troque temporariamente MP_PUBLIC_KEY e MP_ACCESS_TOKEN por esses dois e coloque TRIAL_DAYS = `0`. Depois clique em **Trigger deploy**.
4. No app, crie uma conta com o **e-mail do comprador de teste** e toque em **Assinar no cartão**. Use o cartão Visa `4235 6477 2802 5682`, validade `11/30`, CVV `123`, nome `APRO` e CPF `123.456.789-09`.
5. Em até 1 hora, **Ajustes → Assinatura** mostra "Ativa no Visa •••• 5682". Com o nome `OTHE`, você vê como fica uma recusa.
6. **Depois, volte as chaves de produção e TRIAL_DAYS = 3** e clique em Trigger deploy.

### 7.5 Teste um Pix de verdade

Com outra conta (de outra pessoa ou de outro banco seu), toque em **Pagar com Pix** no app e pague. A confirmação aparece em segundos. Se quiser, devolva o valor pelo Mercado Pago em **Atividade → o pagamento → Devolver**. A própria conta que recebe não consegue pagar a si mesma.

## 8. Antes de divulgar

Seus dados nos textos legais, nota fiscal e o site antigo.

### 8.1 Confira os Termos e a Privacidade

Abra `https://autograna-app.netlify.app/termos` e `https://autograna-app.netlify.app/privacidade`. Não pode sobrar nada em amarelo: se sobrar, confira EMPRESA_NOME e EMPRESA_DOCUMENTO no Netlify e publique de novo. Os textos são um bom ponto de partida, mas vale a revisão de um advogado.

### 8.2 Veja a nota fiscal com um contador

Vendendo assinatura, você precisa emitir nota. Um contador diz o melhor jeito para o seu caso (MEI ou outro regime).

### 8.3 Acerte o endereço do vídeo e dos banners

O vídeo e os banners mostram autograna.netlify.app. Ou você apaga o site antigo e me pede para renomear o novo para esse endereço, ou me pede o vídeo com o endereço novo.

### 8.4 Feche o site antigo

Quando o novo estiver funcionando, apague o site antigo no Netlify antigo e, se quiser, o projeto antigo no Firebase.

## 9. Depois: atualizar e resolver problemas

Para consultar quando precisar.

### 9.1 Como atualizar o app

- **Mudanças no app**: me peça aqui. Eu envio direto para o GitHub e o Netlify publica sozinho em 1 ou 2 minutos.
- **Preço, contato e textos legais**: basta mudar a variável no Netlify e clicar em Trigger deploy (ou me pedir).

### 9.2 Se algo der errado

- **A publicação falhou (Deploy failed)**: abra o log; a linha com ✖ diz o que falta. Ou me peça para olhar.
- **"Erro 400: redirect_uri_mismatch" no Google**: faltou o passo 6.2, ou o endereço está diferente.
- **"auth/unauthorized-domain" ou domínio não autorizado**: faltou o passo 6.1.
- **"Não consegui consultar sua assinatura"**: confira FIREBASE_SERVICE_ACCOUNT e FIREBASE_WEB_CONFIG e veja em **Logs → Functions → billing**.
- **Os campos do cartão não aparecem, ou o app pede conta no Mercado Pago**: falta a MP_PUBLIC_KEY.
- **"Não deu pra gerar o Pix"**: falta a chave Pix (passo 3.2).
- **Os e-mails não chegam**:
   - Use **Receber e-mails de exemplo** e leia a mensagem que aparece.
   - Se aparecer "usuário ou senha de app recusados", refaça o passo 4.2.
   - Os e-mails automáticos só saem entre 9h e 21h.
- **O app instalado está com cara antiga**: apague o ícone e instale de novo.
