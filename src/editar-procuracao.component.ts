import { Component, OnInit, ViewChild } from '@angular/core';
import {
  FormGroup,
  FormBuilder,
  Validators,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AlertMessageService } from '@serpro/ngx-dsgovbr';
import { BsModalRef } from 'ngx-bootstrap';
import { takeUntil, map } from 'rxjs/operators';
import { Subject } from 'rxjs';
import * as moment from 'moment';

import { Procuracao } from '../../models/procuracao';
import { NgWizardConfig, NgWizardService } from 'ng-wizard';
import { CnpjService } from 'src/app/core/services/cnpj.service';
import { CpfService } from 'src/app/core/services/cpf.service';
import { ProcuracaoState, ProcuracaoStateItem } from '../../procuracao.state';
import { ProcuracaoService } from '../../services/procuracao.service';
import { MessageService } from 'src/app/core/services/message.service';
import { MessageKeys } from 'src/app/shared/enums/message-keys';
import {
  NiUtils,
  MASK_CPF,
  MASK_CNPJ,
  CPFUtils,
  CNPJUtils,
} from 'src/app/shared/utils/ni-utils';
import { AuthService } from 'src/app/core/services/auth.service';
import { SerproSignerClientService } from 'src/app/shared/services/serpro-signer-client.service';
import { ProcuracaoUtils } from '../../procuracao-utils';
import { ngWizardConfig } from './ng-wizard.config';
import { ProcuracaoConverter } from './procuracao-converter';
import { TipoAcaoImpl, TipoAcao } from '../../enums/tipo-acao';
import { DirecaoRelacionadas } from '../../enums/direcao-relacionados';
// tslint:disable-next-line: max-line-length
import { SelecionarServicosProcuracaoComponent } from 'src/app/procuracao/components/editar-procuracao/selecionar-servicos/selecionar-servicos.component';
import { DateUtils } from 'src/app/shared/utils/date-utils';
import { TipoNi } from 'src/app/shared/enums/tipo-ni';
import { AsyncResponsavelLegalValidator } from './async-cpf-responsavel-validator';
import { CnpjValidationService } from '../../services/procuracao-validation.service';
import { MaskDirectiveOptions } from '../../diretivas/mask.directive';
import { AsyncNiOutorgadoValidator } from './async-ni-outorgado-validator';
import { NiService } from '../../../core/services/ni.service';
import { AsyncValidatorFn } from '@angular/forms';
import { AsyncNomeOutorgadoValidator } from './async-nome-outorgado-validator';

@Component({
  selector: 'app-editar-procuracao',
  templateUrl: './editar-procuracao.component.html',
  styleUrls: ['./editar-procuracao.component.scss'],
})
export class EditarProcuracaoComponent implements OnInit {
  private unsubscribe$ = new Subject<any>();

  title: string;
  pagina: number;
  carregouDadosOutorgante: boolean;
  public Content: SafeResourceUrl;

  // variavel de controle de espera de resposta do assinador serpro!
  // usada aqui e na tela para desabilitar ou nao os botoes enquanto o assinador está processando.
  esperandoRespostaAssinadorSerpro: boolean;

  msgAssinarProcuracaoIncluida: boolean;
  msgAssinarProcuracaoRevogada: boolean;

  acao: TipoAcao;
  form: FormGroup;
  procuracao: Procuracao;

  // fim de vigencia da procuracao antecedente (inclusao/alteracao de substabelecimento)
  dataFimVigenciaAntecedente: Date;

  bsModalRef: BsModalRef;

  dataIniVigencia: Date;

  @ViewChild('selecionarServicos', { static: false })
  selecionarServicosComponent!: SelecionarServicosProcuracaoComponent;

  constructor(
    private ngWizardService: NgWizardService,
    private sanitizer: DomSanitizer,
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private niService: NiService,
    private cnpjService: CnpjService,
    private cnpjValidationService: CnpjValidationService,
    private cpfService: CpfService,
    private procuracaoService: ProcuracaoService,
    private state: ProcuracaoState,
    private authService: AuthService,
    private messageService: MessageService,
    private serproSignerService: SerproSignerClientService,
    private alertMessageService: AlertMessageService
  ) {
    this.pagina = 0;
    this.carregouDadosOutorgante = false;
  }

  ngOnInit() {
    this.alertMessageService.dismissAll();
    this.serproSignerService.init();

    this.dataIniVigencia = moment().startOf('day').toDate();

    const route = this.route.snapshot.url;
    this.acao = TipoAcaoImpl.from(route[0].path);
    this.title = `${TipoAcaoImpl.label(this.acao)} Procuração`;

    if (this.acao === TipoAcao.CRIAR) {
      this.initCriarProcuracao();
    } else if (this.acao === TipoAcao.SUBSTABELECER) {
      this.initSubstabelecerProcuracao();
    } else {
      this.initAlterarProcuracaoOuSubstabelecimento();
    }
  }

  // tslint:disable-next-line: use-lifecycle-interface
  ngOnDestroy() {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  private initCriarProcuracao() {
    // criar nova procuracao
    this.procuracao = new Procuracao().deserialize({
      dataIniVigencia: this.dataIniVigencia,
      inSubstabelecer: false,
      inAmplosPoderes: false,
      nivel: 0,
      servicos: [],
    });
    this.buildForm(this.procuracao);
  }

  private initSubstabelecerProcuracao() {
    // identificador da procuracao a ser substabelecida (antecedente)
    const dados = this.state.getAttribute(
      ProcuracaoStateItem.DADOS_PROCURACAO
    ) as Procuracao;

    // recuperar procuracao antecedente para substabelecer
    this.procuracaoService
      .recuperar(dados.uid, {
        servicos: true,
        relacionadas: true,
        direcao: DirecaoRelacionadas.ASC,
      })
      .subscribe((antecedente) => {
        const relacionadas = antecedente.relacionadas || [];
        this.dataFimVigenciaAntecedente = antecedente.dataFimVigencia;
        this.procuracao = new Procuracao().deserialize({
          dataIniVigencia: this.dataIniVigencia,
          inSubstabelecer: false,
          inAmplosPoderes: antecedente.inAmplosPoderes,
          nivel: antecedente.nivel + 1,
          // identificador da procuracao antecedente
          uidAntecedente: antecedente.uid,
          // outorgante da procuracao raiz se torna titular na substabelecida
          relacionadas: [antecedente, ...relacionadas],
          // outorgado da procuracao antecedente vira outorgante na substabelecida
          ...antecedente.getOutorganteParaSubstabelecimento(),
        });
        this.carregouDadosOutorgante = true;
        this.buildForm(this.procuracao);
      });
  }

  private initAlterarProcuracaoOuSubstabelecimento() {
    // identificador da procuracao a ser alterada
    const dadosProcuracao = this.state.getAttribute(
      ProcuracaoStateItem.DADOS_PROCURACAO
    ) as Procuracao;

    // recuperar procuracao ou substabelecimento para
    this.procuracaoService
      .recuperar(dadosProcuracao.uid, {
        servicos: true,
        relacionadas: true,
        direcao: DirecaoRelacionadas.ASC,
      })
      .subscribe((value) => {
        // se substabelecimento, recuperar a procuracao antecedente
        // TODO: Verificar este codigo (relacionadas deveria vir undefined?)
        if (value.nivel > 0 && value.relacionadas) {
          const antecedente = value.relacionadas.find(
            (item) => item.nivel === value.nivel - 1
          );
          value.uidAntecedente = antecedente.uid;
          this.dataFimVigenciaAntecedente = antecedente.dataFimVigencia;
        }
        this.procuracao = new Procuracao().deserialize(value);
        this.carregouDadosOutorgante = true;
        this.buildForm(this.procuracao);
      });
  }

  isAcaoCriar(): boolean {
    return this.acao === TipoAcao.CRIAR;
  }

  isAcaoSubstabelecer(): boolean {
    return this.acao === TipoAcao.SUBSTABELECER;
  }

  getNgWizardConfig(): NgWizardConfig {
    return ngWizardConfig;
  }

  isSerproSignerRunningAndAuthorized(): boolean {
    return this.serproSignerService.isSerproSignerRunningAndAuthorized();
  }

  getCepMask(): MaskDirectiveOptions {
    return {
      maxLength: 8,
      clear: /\D/g,
      replace: [/^(\d{5})(\d)/, '$1-$2'],
    };
  }

  getNumeroMask(): MaskDirectiveOptions {
    return {
      maxLength: 10,
      clear: /\D/g,
    };
  }

  getUfMask(): MaskDirectiveOptions {
    return {
      maxLength: 2,
      transform: 'Upper',
      clear: /[^a-zA-Z]/g,
    };
  }

  get(path: string): AbstractControl {
    return this.form.get(path);
  }

  private buildForm(procuracao: Procuracao): void {
    const data = procuracao.toForm();
    let tipoNi = TipoNi.CPF;
    if (data.niOutorgado) {
      tipoNi = NiUtils.tipoNi(data.niOutorgado);
    }

    this.form = this.formBuilder.group({
      tipoNiOutorgado: [tipoNi, [Validators.required]],
      niOutorgado: [
        data.niOutorgado,
        [this.validaNiOutorgadoIgualUsuarioLogado()],
      ],
      nomeOutorgado: [data.nomeOutorgado, [Validators.required]],
      // cepOutorgado: [data.cepOutorgado,  [Validators.required, this.validarLengthFactory(8, 'CEP inválido')]],
      cepOutorgado: [data.cepOutorgado, [Validators.required]],
      logradouroOutorgado: [data.logradouroOutorgado, [Validators.required]],
      numeroOutorgado: [data.numeroOutorgado, [Validators.required]],
      complementoOutorgado: [data.complementoOutorgado],
      bairroOutorgado: [data.bairroOutorgado],
      ufOutorgado: [data.ufOutorgado, [Validators.required]],
      municipioOutorgado: [data.municipioOutorgado, [Validators.required]],
      qualificacaoOutorgado: [data.qualificacaoOutorgado], // PF
      cpfRepresOutorgado: [data.cpfRepresOutorgado], // PJ
      nomeRepresOutorgado: [data.nomeRepresOutorgado], // PJ
      emailOutorgado: [data.emailOutorgado],
      dataFimVigencia: [
        data.dataFimVigencia,
        [this.validarDataFimVigenciaFactory(this.getDtLimiteVigencia())],
      ],
      // substabelecimento desativado para procuracao nivel 2
      inSubstabelecer: [
        { value: data.inSubstabelecer, disabled: data.nivel > 1 },
      ],
    });
    // para evitar erro de 'undefined'
    this.form
      .get('niOutorgado')
      .setAsyncValidators(
        AsyncNiOutorgadoValidator.validateFactory(this.niService)
      );
    this.form
      .get('cpfRepresOutorgado')
      .setAsyncValidators(
        AsyncResponsavelLegalValidator.validateFactory(
          this.cnpjValidationService
        )
      );

    this.setConditionalValidators();

    this.form
      .get('tipoNiOutorgado')
      .valueChanges.pipe(takeUntil(this.unsubscribe$))
      .subscribe((value) => {
        this.clearConditionalControls();
        this.setConditionalValidators(value);
      });

    // [Viktor]: Reinicia validadores quando o valor é modificado
    this.updateValidatorsOnChangeValue(
      'nomeOutorgado',
      [Validators.required],
      []
    );
    this.updateValidatorsOnChangeValue('cepOutorgado', [Validators.required]);
    this.updateValidatorsOnChangeValue('ufOutorgado', [Validators.required]);
    this.updateValidatorsOnChangeValue('emailOutorgado', []);
    // Caso especial para os campos de Ni: niOutorgado e cpfRepresOutorgado
    this.get('niOutorgado')
      .valueChanges.pipe(takeUntil(this.unsubscribe$))
      .subscribe((value) => {
        const ni = value ? value.replace(/[^a-zA-Z0-9]/g, '') : '';
        const tipoNiOutorgado = this.get('tipoNiOutorgado').value;
        if (
          (tipoNiOutorgado === TipoNi.CPF && ni.length >= 11) ||
          (tipoNiOutorgado === TipoNi.CNPJ && ni.length >= 14)
        ) {
          this.updateValidators(
            'niOutorgado',
            [Validators.required, this.validarNiFactory(tipoNiOutorgado)],
            [AsyncNiOutorgadoValidator.validateFactory(this.niService)]
          );
          // Se completou o cnpj, também valida o cpf do Representante
          if (tipoNiOutorgado === TipoNi.CNPJ) {
            this.updateValidators(
              'cpfRepresOutorgado',
              [Validators.required, this.validarNiFactory(TipoNi.CPF)],
              [
                AsyncResponsavelLegalValidator.validateFactory(
                  this.cnpjValidationService
                ),
              ]
            );
          }
          const nomeOutorgado = this.get('nomeOutorgado').value;
          if (nomeOutorgado) {
            this.updateValidators(
              'nomeOutorgado',
              [],
              [AsyncNomeOutorgadoValidator.validateFactory(this.niService)]
            );
          }
        } else {
          this.updateValidators('niOutorgado', [Validators.required]);
        }
      });
    this.get('cpfRepresOutorgado')
      .valueChanges.pipe(takeUntil(this.unsubscribe$))
      .subscribe((value) => {
        const cpfRepresOutorgadoCleanValue = value
          ? value.replace(/[^a-zA-Z0-9]/g, '')
          : '';
        if (cpfRepresOutorgadoCleanValue.length >= 11) {
          this.updateValidators(
            'cpfRepresOutorgado',
            [Validators.required, this.validarNiFactory(TipoNi.CPF)],
            [
              AsyncResponsavelLegalValidator.validateFactory(
                this.cnpjValidationService
              ),
            ]
          );
        } else {
          this.updateValidators('cpfRepresOutorgado', [Validators.required]);
        }
      });
  }

  // [Viktor]: Executa validadores de pattern somente quando sai
  // do componente (evento unmask, chamado pelo blur do br-input)
  public onBlur(path: string): void {
    switch (path) {
      case 'cepOutorgado':
        this.updateValidators('cepOutorgado', [
          this.validarLengthFactory(8, 'CEP inválido'),
        ]);
        break;
      case 'ufOutorgado':
        this.updateValidators('ufOutorgado', [
          this.validarLengthFactory(2, 'UF inválida'),
        ]);
        break;
      case 'emailOutorgado':
        this.updateValidators('emailOutorgado', [Validators.email]);
        break;
      case 'nomeOutorgado':
        this.updateValidators(
          'nomeOutorgado',
          [Validators.required],
          [AsyncNomeOutorgadoValidator.validateFactory(this.niService)]
        );
        break;
      case 'cpfRepresOutorgado':
        const cpfRepresOutorgadoValue = this.get('cpfRepresOutorgado').value;
        const cpfRepresOutorgadoCleanValue = cpfRepresOutorgadoValue
          ? cpfRepresOutorgadoValue.replace(/[^a-zA-Z0-9]/g, '')
          : '';
        if (cpfRepresOutorgadoCleanValue.length < 11) {
          this.updateValidators(
            'cpfRepresOutorgado',
            [Validators.required, this.validarNiFactory(TipoNi.CPF)],
            []
          );
        }
        break;
      case 'niOutorgado':
        const tipoNi = this.get('tipoNiOutorgado').value;
        const niOutorgadoValue = this.get('niOutorgado').value;
        const niOutorgadoCleanValue = niOutorgadoValue
          ? niOutorgadoValue.replace(/[^a-zA-Z0-9]/g, '')
          : '';
        if (
          (tipoNi === TipoNi.CPF && niOutorgadoCleanValue.length < 11) ||
          (tipoNi === TipoNi.CNPJ && niOutorgadoCleanValue.length < 14)
        ) {
          this.updateValidators(
            'niOutorgado',
            [Validators.required, this.validarNiFactory(tipoNi)],
            []
          );
        }
        break;
      default:
        console.log('[OnBlur] path inválido: ' + path);
    }
  }

  private validaNiOutorgadoIgualUsuarioLogado(): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      const niUsuario = this.authService.getUsuario().ni;
      const niOutorgado = this.get('niOutorgado').value;
      if (niOutorgado === niUsuario) {
        return {
          customError: {
            message:
              'Não é possível cadastrar/substabelecer procuração para si mesmo',
          },
        };
      }
      return null;
    };
  }

  private validarDataFimVigenciaFactory(dtLimiteVigencia: Date): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      if (c.value && moment(c.value).isBefore(this.dataIniVigencia)) {
        return { customError: { message: 'Data Fim menor que Data Início' } };
      } else if (c.value && moment(c.value).isAfter(dtLimiteVigencia)) {
        return {
          customError: { message: 'Data Fim posterior ao limite estabelecido' },
        };
      }
      return null;
    };
  }

  private validarLengthFactory(length: number, message: string) {
    return (c: AbstractControl): ValidationErrors | null => {
      if (!c.value) {
        return null;
      }
      const value = c.value.replace(/[^a-zA-Z0-9]/g, '');
      if (value.length !== length) {
        return { customError: { message } };
      }
      return null;
    };
  }

  private clearControl(
    path: string,
    defaultValue: any = null,
    markAsUntouched: boolean = true,
    clearValidators: boolean = true
  ) {
    const ctrl = this.get(path);
    ctrl.setValue(defaultValue, { emitEvent: false });
    if (clearValidators) {
      ctrl.setValidators(null);
      // ctrl.setAsyncValidators(null);
    }
    if (markAsUntouched) {
      ctrl.markAsUntouched();
      ctrl.markAsPristine();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private clearConditionalControls() {
    this.clearControl('niOutorgado');
    this.clearControl('cpfRepresOutorgado');
    this.clearControl('nomeRepresOutorgado');
    this.clearControl('qualificacaoOutorgado');
  }

  private setConditionalValidators(tipoNiOutorgado?: any) {
    const tipoNi = tipoNiOutorgado || this.get('tipoNiOutorgado').value;
    this.updateValidators('niOutorgado', [
      Validators.required,
      this.validarNiFactory(tipoNi),
    ]);
    if (tipoNi === TipoNi.CPF) {
      this.get('qualificacaoOutorgado').setValidators([Validators.required]);
    } else {
      this.updateValidators('cpfRepresOutorgado', [
        Validators.required,
        this.validarNiFactory(TipoNi.CPF),
      ]);
      this.updateValidators('nomeRepresOutorgado', [Validators.required]);
    }
  }

  private updateValidators(
    path: string,
    validators: ValidatorFn[],
    asyncValidators: AsyncValidatorFn[] = null
  ) {
    const ctrl = this.get(path);
    if (ctrl) {
      ctrl.setValidators(validators);
      if (asyncValidators) {
        ctrl.setAsyncValidators(asyncValidators);
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    } else {
      console.log('Controle "' + path + '" não definido.');
    }
  }

  private updateValidatorsOnChangeValue(
    path: string,
    validators: ValidatorFn[],
    asyncValidators: AsyncValidatorFn[] = null
  ) {
    this.get(path)
      .valueChanges.pipe(takeUntil(this.unsubscribe$))
      .subscribe((_) =>
        this.updateValidators(path, validators, asyncValidators)
      );
  }

  private validarNiFactory(tipoNi: TipoNi): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) {
        return null;
      }
      const value = control.value.replace(/\D/g, '');
      // Comentado para validar somente ao final da digitação
      if (
        tipoNi === TipoNi.CPF &&
        (value.length !== 11 ||
          (value.length === 11 && !CPFUtils.validar(value)))
      ) {
        // if (tipoNi === TipoNi.CPF && value.length === 11 && !CPFUtils.validar(value)) {
        return { customError: { message: 'CPF inválido' } };
      }
      // Comentado para validar somente ao final da digitação
      if (
        (tipoNi === TipoNi.CNPJ && value.length !== 14) ||
        (value.length === 14 && !CNPJUtils.validar(value))
      ) {
        // if (tipoNi === TipoNi.CNPJ && value.length === 14 && !CNPJUtils.validar(value)) {
        return { customError: { message: 'CNPJ inválido' } };
      }
      return null;
    };
  }

  getLabelNiOutorgado(): string {
    return this.get('tipoNiOutorgado').value;
  }

  getMaskNiOutorgado(): string {
    return this.get('tipoNiOutorgado').value === TipoNi.CPF
      ? MASK_CPF
      : MASK_CNPJ;
  }

  getDescricaoStep1Wizard(): string {
    return this.isAcaoSubstabelecer() ? 'Substabelecido' : 'Outorgado';
  }

  getDtLimiteVigencia(): Date {
    if (this.dataFimVigenciaAntecedente) {
      return this.dataFimVigenciaAntecedente;
    }
    // vigência de 5 anos quando não for informada.
    return moment(this.dataIniVigencia)
      .add(5, 'year')
      .subtract(1, 'day')
      .utc(true)
      .hours(23)
      .minutes(59)
      .seconds(59)
      .toDate();
  }

  getInformativoDtLimiteVigencia(): string {
    if (this.dataFimVigenciaAntecedente) {
      return `Caso não informado, será considerada a data ${DateUtils.formatarDate(
        this.dataFimVigenciaAntecedente
      )}.`;
    }
    // vigência de 5 anos quando não for informada.
    return `Caso não informado, será considerado o período de 5 anos.`;
  }

  onShowPreviousStep(event?: Event) {
    this.ngWizardService.previous();
    this.pagina = Math.max(0, this.pagina - 1);
    this.Content = null;
  }

  onShowNextStep(event?: Event) {
    let proxima = true;
    this.alertMessageService.dismissAll();

    if (this.pagina === 0) {
      if (!this.form.valid) {
        this.form.markAllAsTouched();
        proxima = false;
      } else {
        this.carregarDadosOutorganteOutorgadoParaSalvar();
      }
    } else if (this.pagina === 1) {
      if (!this.hasServicoSelecionado()) {
        proxima = false;
        this.messageService.showMessage(MessageKeys.ProcuracaoSemServico);
      } else {
        this.carregarServicosParaSalvar();

        this.procuracaoService
          .gerarArquivo(this.procuracao)
          .subscribe((response) => {
            const file = new Blob([response], { type: 'application/pdf' });
            const fileURL = URL.createObjectURL(file);
            this.Content =
              this.sanitizer.bypassSecurityTrustResourceUrl(fileURL);

            // caso o servidor do Assinador estiver onLine,
            // gero o base64 da prévia da procuração no componente "hash_value" da tela
            // para uma possivel assinatura do usuário
            if (this.isSerproSignerRunningAndAuthorized()) {
              // pegando o base64 da Procuração pendente de Assinatura
              // para posteriormente realizar a Assinatura usando esse base64
              const fileToLoad = new Blob([response], {
                type: 'application/pdf',
              });

              const fileReader = new FileReader();
              let base64: any;

              // Onload of file read the file content
              fileReader.onload = (fileLoadedEvent: any) => {
                base64 = fileLoadedEvent.target.result;
                document.getElementById('hash_value').innerHTML = base64;
              };
              // Convert data to base64
              fileReader.readAsDataURL(fileToLoad);
            }
          });
      }
    } else if (this.pagina === 2) {
      proxima = false;
      this.salvar();
    }
    this.nextPage(proxima);
  }

  nextPage(proxima: boolean) {
    if (proxima) {
      this.ngWizardService.next();
      this.pagina = Math.min(2, this.pagina + 1);
    }
  }

  /**
   * Verifica se algum serviço foi marcado na tela
   */
  hasServicoSelecionado(): boolean {
    const servicos = this.selecionarServicosComponent.getServicosSelecionados();
    // TODO no futuro incluir verificacao para o check geral 'amplos poderes'
    // proveniente do componente SelecionarServicos
    return servicos.length > 0;
  }

  /**
   * Salvando a Procuração
   */
  salvar(assinar: boolean = false) {
    this.msgAssinarProcuracaoIncluida = false;
    this.msgAssinarProcuracaoRevogada = false;

    if (this.isAcaoCriar() || this.isAcaoSubstabelecer()) {
      this.procuracaoService.incluir(this.procuracao).subscribe((value) => {
        this.procuracao.uid = value;
        if (!assinar) {
          this.messageService.showMessage(
            MessageKeys.ProcuracaoIncluidaSucesso
          );
          this.router.navigate(['/procuracao']);
        } else {
          this.msgAssinarProcuracaoIncluida = true;
          this.onAssinar();
        }
      });
    } else {
      this.procuracaoService.alterar(this.procuracao).subscribe((retorno) => {
        this.procuracao.uid = retorno;
        if (!assinar) {
          this.messageService.showMessage(
            MessageKeys.ProcuracaoRevogadaSucesso
          );
          this.messageService.showMessage(
            MessageKeys.ProcuracaoIncluidaSucesso
          );
          this.router.navigate(['/procuracao']);
        } else {
          this.msgAssinarProcuracaoRevogada = true;
          this.msgAssinarProcuracaoIncluida = true;
          this.onAssinar();
        }
      });
    }
  }

  /**
   * Realizando a Assinatura da Procuração
   * Fazendo a chamada ao Assinador SERPRO
   */
  onAssinar() {
    this.esperandoRespostaAssinadorSerpro = true;
    // guardando referencia correta para "this"
    const self = this;

    const params = {
      type: 'pdf',
      data: document.getElementById('hash_value').innerHTML,
      componentRef: this,
      onSuccess: this.onSuccessPdfHandler,
      onCancel: this.onCancelPdfHandler,
      onError: (msgError: any) => {
        this.tratarErroPdfHandler(msgError, self);
      },
    };

    this.serproSignerService.sign(params);
  }

  private tratarErroPdfHandler(msgError: any, self: this) {
    self.esperandoRespostaAssinadorSerpro = false;
    self.messageService.showMessage(MessageKeys.ProcuracaoIncluidaSucesso);
    self.messageService.showMessage(
      MessageKeys.ProcuracaoAssinaturaErroValidacao
    );
    self.router.navigate(['/procuracao']);
    console.log('Error: ', msgError);
  }

  convertBase64ToFile(dataurl, filename): File {
    return ProcuracaoUtils.dataURLtoFile(dataurl, filename);
  }

  /**
   * Usuário cancelou a Assinatura
   * @param data - sendo retornado no metodo "sign(params)" no arquivo "serpro-signer-client.service.ts"
   * {
   *   response: any
   *   componentRef: AssinarProcuracaoComponent
   * }
   */
  onCancelPdfHandler(data: any) {
    const componentRef = data.componentRef;
    componentRef.esperandoRespostaAssinadorSerpro = false;

    if (componentRef.msgAssinarProcuracaoRevogada) {
      componentRef.messageService.showMessage(
        MessageKeys.ProcuracaoRevogadaSucesso
      );
    }
    if (componentRef.msgAssinarProcuracaoIncluida) {
      componentRef.messageService.showMessage(
        MessageKeys.ProcuracaoIncluidaSucesso
      );
    }
    componentRef.messageService.showMessage(
      MessageKeys.ProcuracaoAssinaturaCanceladaUsuario
    );

    componentRef.router.navigate(['/procuracao']);
  }

  /**
   * Metodo chamado quando do Sucesso na Assinatura
   * @param data - sendo retornado no metodo "sign(params)" no arquivo "serpro-signer-client.service.ts"
   * {
   *   original: {
   *     size: number,
   *     base64: string (base64)
   *   },
   *   signature: {
   *     size: number,
   *     base64: string (base64)
   *   },
   *   componentRef: AssinarProcuracaoComponent
   * }
   */
  onSuccessPdfHandler(data) {
    const componentRef = data.componentRef;

    // preparação do download da Procuração localmente!
    const signedPdfBase64 = data.signature.base64;
    const linkSource = `data:application/pdf;base64,${signedPdfBase64}`;
    const downloadLink = document.createElement('a');
    downloadLink.href = linkSource;
    downloadLink.download = 'procuracao.pdf';

    // arquivo a ser gravado no CEPH
    const file = componentRef.convertBase64ToFile(linkSource, 'procuracao.pdf');

    componentRef.validarAssinatura(
      componentRef,
      signedPdfBase64,
      file,
      downloadLink
    );
  }

  validarAssinatura(
    componentRef: EditarProcuracaoComponent,
    signedPdfBase64: any,
    file: any,
    downloadLink: HTMLAnchorElement
  ) {
    componentRef.serproSignerService
      .validatePDFSignature(signedPdfBase64)
      .success(
        ((data: any) => {
          const validations = data.signerSignatureValidations;
          const niUsuario = this.authService.getUsuario().ni.replace(/\D/g, '');

          const niCertificado = validations[0].valCPF_CNPJ;
          // console.log('editar::validarAssinatura');
          // console.log('niUsuario: ' + niUsuario);
          // console.log('niCertificado: ' + niCertificado);
          if (niUsuario === niCertificado) {
            componentRef.incluirArquivoAssinado(
              componentRef,
              file,
              downloadLink
            );
            return;
          }
          componentRef.messageService.showMessage(
            MessageKeys.ProcuracaoSalvaAssinaturaErroUsuarioCertInvalido
          );
        }).bind(this)
      )
      .error(
        ((cbError: any) => {
          console.log('vCbError', cbError);
        }).bind(this)
      );
  }

  incluirArquivoAssinado(
    componentRef: EditarProcuracaoComponent,
    file: any,
    downloadLink: HTMLAnchorElement
  ) {
    // console.log('[Viktor]: componentRef.procuracao: ', componentRef.procuracao);
    // console.log('[Viktor]: componentRef.procuracao.uid: ', componentRef.procuracao.uid);
    // - Marcando a procuração como Assinada!
    // - Salvando o arquivo assinado na base do CEPH!
    componentRef.procuracaoService
      .incluirArquivoAssinado(componentRef.procuracao.uid, file)
      .subscribe(
        (retorno) => {
          // fazendo o download da Procuração localmente!
          downloadLink.click();

          componentRef.esperandoRespostaAssinadorSerpro = false;

          // deu tudo Ok
          if (componentRef.msgAssinarProcuracaoRevogada) {
            componentRef.messageService.showMessage(
              MessageKeys.ProcuracaoRevogadaSucesso
            );
          }
          if (componentRef.msgAssinarProcuracaoIncluida) {
            componentRef.messageService.showMessage(
              MessageKeys.ProcuracaoIncluidaSucesso
            );
          }
          componentRef.messageService.showMessage(
            MessageKeys.ProcuracaoAssinaturaSucesso
          );
          componentRef.router.navigate(['/procuracao']);
        },
        (error) => {
          componentRef.esperandoRespostaAssinadorSerpro = false;
          componentRef.messageService.showMessage(
            MessageKeys.ProcuracaoAssinaturaErro
          );
        }
      );
  }

  isSalvarAssinarVisible(): boolean {
    return this.pagina === 2 && this.isSerproSignerRunningAndAuthorized();
  }

  /**
   * Salvando e Assinando Digitalmente a Procuração
   */
  onSalvarAssinar() {
    this.salvar(true);
  }

  /***
   * Setando na Procuração as informações da tela
   */
  carregarDadosOutorganteOutorgadoParaSalvar() {
    const formValue = this.form.value;
    this.procuracao = this.procuracao.fromForm(formValue);

    if (!this.get('dataFimVigencia').value) {
      this.procuracao.dataFimVigencia = this.getDtLimiteVigencia();
    }

    // dados do outorgante (usuario logado)
    if (!this.carregouDadosOutorgante) {
      this.carregouDadosOutorgante = true;

      const niUsuario = this.authService.getUsuario().ni;

      if (niUsuario.length === 11) {
        this.cpfService
          .recuperar(niUsuario)
          .pipe(
            map((cpf) => ProcuracaoConverter.outorganteFromCPF(niUsuario, cpf))
          )
          .subscribe((value) => {
            this.procuracao = new Procuracao().deserialize({
              ...this.procuracao,
              ...value,
            });
          });
      } else {
        this.cnpjService
          .recuperar(niUsuario)
          .pipe(map((cnpj) => ProcuracaoConverter.outorganteFromCNPJ(cnpj)))
          .subscribe((value) => {
            this.procuracao = new Procuracao().deserialize({
              ...this.procuracao,
              ...value,
            });
          });
      }
    }
  }

  carregarServicosParaSalvar() {
    const servicos = this.selecionarServicosComponent.getServicosSelecionados();
    this.procuracao.servicos = servicos;
  }

  getLabelAvancarAssinar(): string {
    return this.pagina === 2 ? 'Salvar' : 'Avançar';
  }

  isAvancarAssinarDisabled(): boolean {
    return this.esperandoRespostaAssinadorSerpro;
  }

  isVoltarVisible(): boolean {
    return this.pagina > 0 && !this.esperandoRespostaAssinadorSerpro;
  }

  onCancelDown() {
    // this.form.markAsUntouched();
    this.router.navigate(['/procuracao']);
  }
}
